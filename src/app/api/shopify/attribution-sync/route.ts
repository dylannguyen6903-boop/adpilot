import { NextResponse } from 'next/server';
import {
  getShopifyConfig,
  getValidShopifyConfig,
  isShopifyConfigured,
} from '@/lib/shopify';
import {
  buildCampaignLookup,
  attributeOrder,
  persistAttributions,
  type ShopifyOrderForAttribution,
} from '@/lib/attribution';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

const ATTRIBUTION_QUERY = `
  query AttributionOrders($query: String!, $first: Int!, $after: String) {
    orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          customer {
            email
            numberOfOrders
          }
          customerJourneySummary {
            ready
            firstVisit {
              landingPage
              referrerUrl
              source
              sourceType
              utmParameters {
                source
                medium
                campaign
                content
                term
              }
            }
          }
          lineItems(first: 20) {
            edges {
              node {
                title
                quantity
                sku
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
                product {
                  id
                  productType
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * POST /api/shopify/attribution-sync
 * 
 * Runs the attribution pipeline on recent orders:
 * 1. Fetch orders from Shopify (last N days)
 * 2. Build campaign lookup from campaign_snapshots
 * 3. Attribute each order (multi-method matching)
 * 4. Persist to order_attributions + order_attribution_items
 * 5. Refresh collection_performance_mv
 * 
 * Body: { days?: number } (default: 7)
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // Parse request
    let syncDays = 7;
    try {
      const body = await request.json();
      if (body.days && typeof body.days === 'number' && body.days > 0 && body.days <= 90) {
        syncDays = body.days;
      }
    } catch {
      // No body is fine
    }

    // Get Shopify config
    const customConfig = await getValidShopifyConfig();
    const config = customConfig || getShopifyConfig();
    if (!isShopifyConfigured(config)) {
      return NextResponse.json({ error: 'Shopify not configured' }, { status: 400 });
    }

    // Fetch orders
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - syncDays);
    const queryStr = `created_at:>='${sinceDate.toISOString().split('T')[0]}'`;
    
    const domain = config.storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${domain}/admin/api/2026-04/graphql.json`;

    const allOrders: ShopifyOrderForAttribution[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage && allOrders.length < 500) {
      const response: Response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': config.accessToken,
        },
        body: JSON.stringify({
          query: ATTRIBUTION_QUERY,
          variables: { query: queryStr, first: 50, after: cursor },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return NextResponse.json({
          error: `Shopify API error: ${response.status}`,
          detail: text.substring(0, 500),
        }, { status: 500 });
      }

      const json = await response.json();
      if (json.errors) {
        return NextResponse.json({ error: 'GraphQL errors', errors: json.errors }, { status: 500 });
      }

      const edges = json.data?.orders?.edges || [];
      for (const edge of edges) {
        allOrders.push(edge.node);
      }
      hasNextPage = json.data?.orders?.pageInfo?.hasNextPage || false;
      cursor = json.data?.orders?.pageInfo?.endCursor || null;
    }

    if (allOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No orders found in date range',
        ordersProcessed: 0,
        durationMs: Date.now() - startTime,
      });
    }

    // Extract campaign IDs and candidate names from orders for lookup
    // TKT-00262: Split utm_campaign into numeric IDs vs non-numeric candidate names
    const campaignIds: string[] = [];
    const candidateNames: string[] = [];

    const isLikelyCampaignId = (val: string): boolean => /^\d{5,}$/.test(val.trim());

    for (const order of allOrders) {
      const utm = order.customerJourneySummary?.firstVisit?.utmParameters;
      if (utm?.campaign) {
        const raw = String(utm.campaign).trim();
        if (isLikelyCampaignId(raw)) {
          campaignIds.push(raw);
        } else if (raw) {
          // Non-numeric utm_campaign: treat as campaign name for name-based matching
          candidateNames.push(raw.toLowerCase());
        }
      }
      if (utm?.source) {
        const normSource = String(utm.source).trim().toLowerCase();
        // Exclude generic platform names - only pass potential campaign names
        if (normSource && !['facebook', 'fb', 'instagram', 'ig', 'google', 'google ads', 'google_ads', 'shop_app', 'shopify'].includes(normSource)) {
          candidateNames.push(normSource);
        }
      }
    }

    // Build campaign lookup (includes name-based matching per TKT-00240 P1-3)
    const lookup = await buildCampaignLookup([...new Set(campaignIds)], [...new Set(candidateNames)]);

    // Load collection cache
    const { data: cachedCollections } = await supabaseAdmin
      .from('product_collection_cache')
      .select('shopify_product_id, canonical_collection')
      .limit(10000);
    
    const collectionCache = new Map<string, string>();
    for (const c of cachedCollections || []) {
      collectionCache.set(c.shopify_product_id, c.canonical_collection);
    }

    // Attribute all orders (async due to email hashing)
    const attributions = await Promise.all(
      allOrders.map(order => attributeOrder(order, lookup, collectionCache))
    );

    // Persist
    const result = await persistAttributions(attributions);

    // Note: Materialized view refresh removed (TKT-00240 P2-4)
    // Collection P&L is computed directly by /api/shopify/collections

    // Calculate coverage stats
    const typeCounts: Record<string, number> = {};
    for (const attr of attributions) {
      typeCounts[attr.attribution_type] = (typeCounts[attr.attribution_type] || 0) + 1;
    }

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      syncDays,
      ordersProcessed: allOrders.length,
      ordersUpserted: result.ordersUpserted,
      itemsInserted: result.itemsInserted,
      errors: result.errors.length > 0 ? result.errors : undefined,
      coverage: typeCounts,
      campaignsInLookup: lookup.idSet.size,
      collectionsInCache: collectionCache.size,
      durationMs,
    });
  } catch (err) {
    return NextResponse.json({
      error: 'Attribution sync failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

// GET handler for browser-triggered sync (bypasses Vercel deployment protection)
// Requires ?confirm=true to actually run (TKT-00242 P2 - prevent accidental GET mutations)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7', 10);
  const confirm = url.searchParams.get('confirm') === 'true';

  if (!confirm) {
    return NextResponse.json({
      warning: 'GET /attribution-sync mutates data. Add ?confirm=true to execute.',
      usage: `/api/shopify/attribution-sync?days=${days}&confirm=true`,
    });
  }
  
  const fakeRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: Math.min(Math.max(days, 1), 90) }),
  });
  
  return POST(fakeRequest);
}
