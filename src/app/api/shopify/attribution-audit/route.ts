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
 * Phase 0 v2: Data Quality Audit for Product Attribution
 * 
 * Updated per May TKT-00238:
 * - Primary match: utm_campaign (numeric ID) → campaign_snapshots.campaign_id
 * - Secondary match: utm_source (campaign name) → campaign_snapshots.campaign_name
 * - Coverage breakdown by method: id_match, name_match, unmatched, facebook_only, unattributed
 * - Includes all 30-day campaigns (not just recent snapshots)
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

type MatchMethod = 'id_match' | 'name_match' | 'duplicate_ambiguous' | 'unmatched' | 'facebook_only' | 'google_ads' | 'organic_direct' | 'unattributed';

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return decodeURIComponent(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function GET() {
  try {
    // Get Shopify config
    const customConfig = await getValidShopifyConfig();
    const config = customConfig || getShopifyConfig();
    if (!isShopifyConfigured(config)) {
      return NextResponse.json({ error: 'Shopify not configured' }, { status: 400 });
    }

    // Fetch orders from last 7 days FIRST to know which campaigns to look for
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const queryStr = `created_at:>='${sevenDaysAgo.toISOString().split('T')[0]}'`;

    const domain = config.storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${domain}/admin/api/2026-04/graphql.json`;

    const allOrders: AuditOrder[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage && allOrders.length < 200) {
      const response: Response = await fetch(url, {
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
        return NextResponse.json({ error: 'GraphQL errors', errors: json.errors }, { status: 500 });
      }

      const edges = json.data?.orders?.edges || [];
      for (const edge of edges) {
        allOrders.push(edge.node);
      }
      hasNextPage = json.data?.orders?.pageInfo?.hasNextPage || false;
      cursor = json.data?.orders?.pageInfo?.endCursor || null;
    }

    // Extract unique campaign IDs and names from orders
    const orderCampaignIds = new Set<string>();
    const orderCampaignNames = new Set<string>();
    for (const order of allOrders) {
      const utm = order.customerJourneySummary?.firstVisit?.utmParameters;
      if (utm?.campaign) orderCampaignIds.add(String(utm.campaign).trim());
      if (utm?.source) {
         const norm = normalize(utm.source);
         if (norm && norm !== 'facebook' && norm !== 'fb' && norm !== 'ig' && norm !== 'instagram') {
             orderCampaignNames.add(norm);
         }
      }
    }

    // Fetch campaigns matching the IDs
    const idList = Array.from(orderCampaignIds);
    const { data: idCampaigns } = idList.length > 0 
      ? await supabaseAdmin.from('campaign_snapshots').select('campaign_id, campaign_name').in('campaign_id', idList)
      : { data: [] };

    // For names, because PostgREST .in() fails with commas, we fetch all campaigns with a high limit 
    // to capture name-based matches. Since this is just an audit, taking 50000 rows is okay.
    const { data: nameCampaigns } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, campaign_name')
      .order('snapshot_date', { ascending: false })
      .limit(50000);

    const campaigns = [...(idCampaigns || []), ...(nameCampaigns || [])];

    // Build ID set and name→IDs map
    const campaignIdSet = new Set<string>();
    const campaignNameMap = new Map<string, string[]>();
    const campaignNames = new Set<string>();

    for (const c of campaigns) {
      if (c.campaign_id) campaignIdSet.add(String(c.campaign_id));
      
      const normalized = normalize(c.campaign_name);
      if (normalized) {
        campaignNames.add(normalized);
        if (!campaignNameMap.has(normalized)) {
          campaignNameMap.set(normalized, []);
        }
        if (!campaignNameMap.get(normalized)!.includes(String(c.campaign_id))) {
          campaignNameMap.get(normalized)!.push(String(c.campaign_id));
        }
      }
    }

    // Check for duplicate campaign names
    const duplicateNames: string[] = [];
    for (const [name, ids] of campaignNameMap) {
      if (ids.length > 1) {
        duplicateNames.push(`"${name}" → ${ids.length} IDs: [${ids.join(', ')}]`);
      }
    }

    // === ANALYZE ORDERS (Multi-method matching) ===
    let journeyReady = 0;
    let totalRevenue = 0;
    const methodCounts: Record<MatchMethod, number> = {
      id_match: 0, name_match: 0, duplicate_ambiguous: 0,
      unmatched: 0, facebook_only: 0, google_ads: 0, organic_direct: 0, unattributed: 0,
    };
    const methodRevenue: Record<MatchMethod, number> = {
      id_match: 0, name_match: 0, duplicate_ambiguous: 0,
      unmatched: 0, facebook_only: 0, google_ads: 0, organic_direct: 0, unattributed: 0,
    };

    const utmCampaignValues: Record<string, number> = {};
    const utmSourceValues: Record<string, number> = {};
    const productTypes: Record<string, number> = {};
    const unmatchedDetails: Array<{ utm_source: string; utm_campaign: string; orders: number; revenue: number }> = [];
    const unmatchedMap = new Map<string, { orders: number; revenue: number }>();

    for (const order of allOrders) {
      const revenue = parseFloat(order.totalPriceSet.shopMoney.amount);
      totalRevenue += revenue;

      const journey = order.customerJourneySummary;
      const firstVisit = journey?.firstVisit;
      const utm = firstVisit?.utmParameters;

      if (journey?.ready) journeyReady++;

      const utmCampaign = utm?.campaign || null;
      const utmSource = utm?.source || null;
      let matched: MatchMethod = 'unattributed';

      // === PRIORITY A: utm_campaign numeric ID → campaign_snapshots.campaign_id ===
      if (utmCampaign) {
        const cleanId = String(utmCampaign).trim();
        utmCampaignValues[cleanId] = (utmCampaignValues[cleanId] || 0) + 1;
        
        if (campaignIdSet.has(cleanId)) {
          matched = 'id_match';
        }
      }

      // === PRIORITY B/C: utm_source or utm_campaign as name → campaign_name ===
      if (matched === 'unattributed' && utmSource) {
        const normalizedSource = normalize(utmSource);
        utmSourceValues[normalizedSource] = (utmSourceValues[normalizedSource] || 0) + 1;

        if (normalizedSource === 'facebook' || normalizedSource === 'fb' || normalizedSource === 'instagram' || normalizedSource === 'ig') {
          matched = 'facebook_only';
        } else if (normalizedSource === 'google' || normalizedSource === 'google ads' || normalizedSource === 'google_ads') {
          matched = 'google_ads';
          const key = `${normalizedSource}||${utmCampaign || ''}`;
          const existing = unmatchedMap.get(key) || { orders: 0, revenue: 0 };
          existing.orders++;
          existing.revenue += revenue;
          unmatchedMap.set(key, existing);
        } else if (normalizedSource === 'shop_app' || normalizedSource === 'shopify') {
          matched = 'organic_direct';
        } else if (campaignNames.has(normalizedSource)) {
          const ids = campaignNameMap.get(normalizedSource)!;
          if (ids.length === 1) {
            matched = 'name_match';
          } else {
            matched = 'duplicate_ambiguous';
          }
        } else {
          matched = 'unmatched';
          const key = `${normalizedSource}||${utmCampaign || ''}`;
          const existing = unmatchedMap.get(key) || { orders: 0, revenue: 0 };
          existing.orders++;
          existing.revenue += revenue;
          unmatchedMap.set(key, existing);
        }
      } else if (matched === 'unattributed') {
        // No UTM at all - check source/referrer
        const source = firstVisit?.source;
        const referrer = firstVisit?.referrerUrl;
        if (source?.toLowerCase().includes('facebook') || referrer?.includes('facebook.com')) {
          matched = 'facebook_only';
        } else if (source?.toLowerCase().includes('google') || referrer?.includes('google.com')) {
          matched = 'google_ads';
        } else if (source || referrer) {
          matched = 'organic_direct';
        }
        // else stays 'unattributed'
      }

      methodCounts[matched]++;
      methodRevenue[matched] += revenue;

      // Product types
      for (const item of order.lineItems.edges) {
        const pt = item.node.product?.productType || 'unknown';
        productTypes[pt] = (productTypes[pt] || 0) + 1;
      }
    }

    // Build unmatched details for alias mapping
    for (const [key, data] of unmatchedMap) {
      const [source, campaign] = key.split('||');
      unmatchedDetails.push({
        utm_source: source,
        utm_campaign: campaign || '(none)',
        orders: data.orders,
        revenue: Math.round(data.revenue * 100) / 100,
      });
    }
    unmatchedDetails.sort((a, b) => b.orders - a.orders);

    const totalOrders = allOrders.length;
    const totalAttributed = methodCounts.id_match + methodCounts.name_match;
    const coveragePercent = totalOrders > 0 ? Math.round((totalAttributed / totalOrders) * 100) : 0;

    // Paid FB traffic = orders that came from Facebook ads (matched + unmatched + fb_only)
    const paidFbOrders = methodCounts.id_match + methodCounts.name_match + methodCounts.duplicate_ambiguous + methodCounts.unmatched + methodCounts.facebook_only;
    const paidFbMatched = methodCounts.id_match + methodCounts.name_match;
    const paidFbCoverage = paidFbOrders > 0 ? Math.round((paidFbMatched / paidFbOrders) * 100) : 0;

    // Determine GO/NO-GO based on paid FB coverage (the meaningful metric)
    let goStatus: string;
    if (paidFbCoverage >= 50) {
      goStatus = `🟢 GO — paid FB attribution ${paidFbCoverage}% (${paidFbMatched}/${paidFbOrders} FB orders matched). Proceed Phase 1`;
    } else if (coveragePercent >= 30) {
      goStatus = '🟡 MARGINAL — investigate unmatched FB campaigns';
    } else {
      goStatus = '🔴 NO-GO — attribution too low. Re-sync FB campaigns first';
    }

    const report = {
      audit_version: 'v3 (multi-method + traffic classification)',
      audit_date: new Date().toISOString(),
      period: `Last 7 days (since ${sevenDaysAgo.toISOString().split('T')[0]})`,

      // Summary
      total_orders: totalOrders,
      total_revenue: `$${totalRevenue.toFixed(2)}`,
      overall_coverage_percent: coveragePercent,
      paid_fb_coverage_percent: paidFbCoverage,
      paid_fb_orders: paidFbOrders,
      paid_fb_matched: paidFbMatched,
      go_no_go: goStatus,

      // Coverage by method
      coverage_by_method: {
        id_match: { count: methodCounts.id_match, revenue: `$${methodRevenue.id_match.toFixed(2)}`, note: 'utm_campaign ID matched to campaign_snapshots' },
        name_match: { count: methodCounts.name_match, revenue: `$${methodRevenue.name_match.toFixed(2)}`, note: 'utm_source name matched to campaign_name (unique)' },
        duplicate_ambiguous: { count: methodCounts.duplicate_ambiguous, revenue: `$${methodRevenue.duplicate_ambiguous.toFixed(2)}`, note: 'Name matched but multiple campaign IDs — needs manual alias' },
        unmatched: { count: methodCounts.unmatched, revenue: `$${methodRevenue.unmatched.toFixed(2)}`, note: 'Has FB UTM but campaign not found in DB' },
        facebook_only: { count: methodCounts.facebook_only, revenue: `$${methodRevenue.facebook_only.toFixed(2)}`, note: 'Source is Facebook but no campaign-level UTM' },
        google_ads: { count: methodCounts.google_ads, revenue: `$${methodRevenue.google_ads.toFixed(2)}`, note: 'Google Ads / Google Shopping traffic (not FB attribution scope)' },
        organic_direct: { count: methodCounts.organic_direct, revenue: `$${methodRevenue.organic_direct.toFixed(2)}`, note: 'Organic, direct, Shopify app, or other non-paid traffic' },
        unattributed: { count: methodCounts.unattributed, revenue: `$${methodRevenue.unattributed.toFixed(2)}`, note: 'No UTM, no source, no referrer at all' },
      },

      // Data for alias mapping (unmatched UTMs)
      unmatched_for_alias_mapping: unmatchedDetails,

      // Campaign DB stats
      campaigns_in_db: {
        unique_ids: campaignIdSet.size,
        unique_names: campaignNames.size,
        duplicate_names: duplicateNames.length > 0 ? duplicateNames : 'None ✅',
      },

      // UTM values found in orders
      utm_campaign_values_in_orders: utmCampaignValues,
      utm_source_values_in_orders: utmSourceValues,

      // Readiness metrics
      journey_ready: `${journeyReady}/${totalOrders} (${totalOrders > 0 ? Math.round(journeyReady/totalOrders*100) : 0}%)`,
      product_types: productTypes,

      // Sample orders (first 5)
      sample_orders: allOrders.slice(0, 5).map(o => ({
        name: o.name,
        revenue: o.totalPriceSet.shopMoney.amount,
        journey_ready: o.customerJourneySummary?.ready,
        utm_source: o.customerJourneySummary?.firstVisit?.utmParameters?.source,
        utm_campaign: o.customerJourneySummary?.firstVisit?.utmParameters?.campaign,
        utm_content: o.customerJourneySummary?.firstVisit?.utmParameters?.content,
        utm_term: o.customerJourneySummary?.firstVisit?.utmParameters?.term,
        source: o.customerJourneySummary?.firstVisit?.source,
        referrer: o.customerJourneySummary?.firstVisit?.referrerUrl?.substring(0, 80),
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
