import { NextResponse } from 'next/server';
import {
  getShopifyConfig,
  getValidShopifyConfig,
  isShopifyConfigured,
} from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

/**
 * GET /api/shopify/attribution-audit
 * Phase 0: Data Quality Audit for Product Attribution
 * 
 * Checks:
 * 1. How many orders in last 7 days
 * 2. % orders with customerJourneySummary.ready
 * 3. % orders with utm_source containing campaign name
 * 4. % campaign names matched against campaign_snapshots
 * 5. % orders unattributed
 * 6. Duplicate campaign name check across accounts
 */

const AUDIT_QUERY = `
  query AuditOrders($query: String!, $first: Int!, $after: String) {
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
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
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

interface AuditOrder {
  id: string;
  name: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string } };
  customerJourneySummary: {
    ready: boolean;
    firstVisit: {
      landingPage: string | null;
      referrerUrl: string | null;
      source: string | null;
      sourceType: string | null;
      utmParameters: {
        source: string | null;
        medium: string | null;
        campaign: string | null;
        content: string | null;
        term: string | null;
      } | null;
    } | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        product: {
          id: string;
          productType: string | null;
        } | null;
      };
    }>;
  };
}

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function GET() {
  try {
    // Get Shopify config
    const customConfig = await getValidShopifyConfig();
    const config = customConfig || getShopifyConfig();
    if (!isShopifyConfigured(config)) {
      return NextResponse.json({ error: 'Shopify not configured' }, { status: 400 });
    }

    // Fetch campaign names from campaign_snapshots for matching
    const { data: campaigns } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, campaign_name')
      .order('snapshot_date', { ascending: false })
      .limit(200);

    const campaignNameMap = new Map<string, string[]>();
    const campaignNames = new Set<string>();
    for (const c of campaigns || []) {
      const normalized = normalize(c.campaign_name);
      if (normalized) {
        campaignNames.add(normalized);
        if (!campaignNameMap.has(normalized)) {
          campaignNameMap.set(normalized, []);
        }
        if (!campaignNameMap.get(normalized)!.includes(c.campaign_id)) {
          campaignNameMap.get(normalized)!.push(c.campaign_id);
        }
      }
    }

    // Check for duplicate campaign names
    const duplicateNames: string[] = [];
    for (const [name, ids] of campaignNameMap) {
      if (ids.length > 1) {
        duplicateNames.push(`"${name}" → ${ids.length} campaign IDs`);
      }
    }

    // Fetch orders from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const queryStr = `created_at:>='${sevenDaysAgo.toISOString().split('T')[0]}'`;

    const domain = config.storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${domain}/admin/api/2026-04/graphql.json`;

    const allOrders: AuditOrder[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage && allOrders.length < 100) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': config.accessToken,
        },
        body: JSON.stringify({
          query: AUDIT_QUERY,
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
        return NextResponse.json({
          error: 'GraphQL errors',
          errors: json.errors,
        }, { status: 500 });
      }

      const edges = json.data?.orders?.edges || [];
      for (const edge of edges) {
        allOrders.push(edge.node);
      }
      hasNextPage = json.data?.orders?.pageInfo?.hasNextPage || false;
      cursor = json.data?.orders?.pageInfo?.endCursor || null;
    }

    // Analyze orders
    let journeyReady = 0;
    let hasUtmSource = 0;
    let utmMatchedCampaign = 0;
    let utmUnmatched = 0;
    let sourceFacebook = 0;
    let referrerFacebook = 0;
    let fullyUnattributed = 0;
    let totalRevenue = 0;
    let attributedRevenue = 0;

    const utmSourceValues: Record<string, number> = {};
    const sourceValues: Record<string, number> = {};
    const productTypes: Record<string, number> = {};
    const unmatchedUtmSources: string[] = [];

    for (const order of allOrders) {
      const revenue = parseFloat(order.totalPriceSet.shopMoney.amount);
      totalRevenue += revenue;

      const journey = order.customerJourneySummary;
      const firstVisit = journey?.firstVisit;
      const utm = firstVisit?.utmParameters;

      // Check journey ready
      if (journey?.ready) journeyReady++;

      // Check utm_source
      const utmSource = utm?.source;
      if (utmSource) {
        hasUtmSource++;
        const normalized = normalize(utmSource);
        utmSourceValues[normalized] = (utmSourceValues[normalized] || 0) + 1;

        // Try to match against campaign names
        if (campaignNames.has(normalized)) {
          utmMatchedCampaign++;
          attributedRevenue += revenue;
        } else if (normalized === 'facebook' || normalized === 'fb' || normalized === 'instagram' || normalized === 'ig') {
          // utm_source is generic "facebook", not a campaign name
          sourceFacebook++;
        } else {
          utmUnmatched++;
          if (!unmatchedUtmSources.includes(normalized)) {
            unmatchedUtmSources.push(normalized);
          }
        }
      } else {
        // No UTM, check source/referrer
        const source = firstVisit?.source;
        if (source) {
          sourceValues[normalize(source)] = (sourceValues[normalize(source)] || 0) + 1;
          if (source.toLowerCase().includes('facebook') || source.toLowerCase().includes('fb')) {
            referrerFacebook++;
          }
        }

        const referrer = firstVisit?.referrerUrl;
        if (referrer && referrer.includes('facebook.com')) {
          referrerFacebook++;
        }

        if (!source && !referrer) {
          fullyUnattributed++;
        }
      }

      // Product types
      for (const item of order.lineItems.edges) {
        const pt = item.node.product?.productType || 'unknown';
        productTypes[pt] = (productTypes[pt] || 0) + 1;
      }
    }

    const totalOrders = allOrders.length;
    const coveragePercent = totalOrders > 0 ? Math.round((utmMatchedCampaign / totalOrders) * 100) : 0;

    // Build report
    const report = {
      audit_date: new Date().toISOString(),
      period: `Last 7 days (since ${sevenDaysAgo.toISOString().split('T')[0]})`,
      
      // Summary
      total_orders: totalOrders,
      total_revenue: `$${totalRevenue.toFixed(2)}`,
      attribution_coverage_percent: coveragePercent,
      go_no_go: coveragePercent >= 50 ? '🟢 GO — proceed Phase 1' : coveragePercent >= 30 ? '🟡 MARGINAL — investigate unmatched' : '🔴 NO-GO — attribution too low',

      // Attribution breakdown
      attribution: {
        journey_ready: `${journeyReady}/${totalOrders} (${totalOrders > 0 ? Math.round(journeyReady/totalOrders*100) : 0}%)`,
        has_utm_source: `${hasUtmSource}/${totalOrders} (${totalOrders > 0 ? Math.round(hasUtmSource/totalOrders*100) : 0}%)`,
        utm_matched_campaign: `${utmMatchedCampaign}/${totalOrders} (${coveragePercent}%)`,
        utm_unmatched: `${utmUnmatched}/${totalOrders}`,
        source_facebook_generic: `${sourceFacebook}/${totalOrders}`,
        referrer_facebook: `${referrerFacebook}/${totalOrders}`,
        fully_unattributed: `${fullyUnattributed}/${totalOrders}`,
        attributed_revenue: `$${attributedRevenue.toFixed(2)} of $${totalRevenue.toFixed(2)}`,
      },

      // UTM source values found
      utm_source_values: utmSourceValues,
      unmatched_utm_sources: unmatchedUtmSources,

      // Source values (non-UTM)
      source_values: sourceValues,

      // Campaign matching
      campaigns_in_db: campaignNames.size,
      campaign_names_sample: Array.from(campaignNames).slice(0, 10),
      duplicate_campaign_names: duplicateNames.length > 0 ? duplicateNames : 'None — all unique ✅',

      // Product types
      product_types: productTypes,

      // Raw order samples (first 3 for debugging)
      sample_orders: allOrders.slice(0, 3).map(o => ({
        name: o.name,
        revenue: o.totalPriceSet.shopMoney.amount,
        journey_ready: o.customerJourneySummary?.ready,
        utm_source: o.customerJourneySummary?.firstVisit?.utmParameters?.source,
        utm_campaign: o.customerJourneySummary?.firstVisit?.utmParameters?.campaign,
        source: o.customerJourneySummary?.firstVisit?.source,
        referrer: o.customerJourneySummary?.firstVisit?.referrerUrl,
        landing_page: o.customerJourneySummary?.firstVisit?.landingPage,
        line_items: o.lineItems.edges.map(e => e.node.title).slice(0, 3),
      })),
    };

    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({
      error: 'Audit failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
