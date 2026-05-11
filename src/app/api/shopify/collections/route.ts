import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/shopify/collections
 * 
 * Returns Collection P&L data with proper attribution separation.
 * 
 * TKT-00240 P1 fixes:
 * - P1-1: Separate revenue buckets (attributed_fb, non_fb, unattributed)
 *   instead of blending all orders into one ROAS
 * - P1-2: Per campaign/date spend allocation per SRS formula:
 *   For each (campaign_id, order_date), compute collection revenue share
 *   within that campaign/date, allocate that campaign/date spend by share,
 *   then sum by collection.
 * 
 * Query params:
 *   days=7 (default, max 90)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get('days') || '7', 10), 90);
    
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceDateStr = sinceDate.toISOString().split('T')[0];

    // Fetch attribution items with parent order info
    const { data: collectionData, error: collError } = await supabaseAdmin
      .from('order_attribution_items')
      .select(`
        collection_key,
        item_revenue,
        quantity,
        order_attribution_id,
        order_attributions!inner (
          order_date,
          attribution_type,
          matched_campaign_id,
          total_revenue
        )
      `)
      .gte('order_attributions.order_date', sinceDateStr);

    if (collError) {
      return NextResponse.json({ error: collError.message }, { status: 500 });
    }

    // ─── Phase 1: Aggregate per collection with separated buckets ───
    const collections: Record<string, {
      // Separated revenue buckets (P1-1)
      attributed_fb_revenue: number;
      non_fb_revenue: number;     // google_ads, organic_direct
      unattributed_revenue: number;
      total_revenue: number;
      orders: Set<string>;
      items_sold: number;
      // For per-campaign/date spend allocation (P1-2)
      campaignDateRevenue: Map<string, number>; // "campaign_id|date" → revenue in this collection
    }> = {};

    // Also track total revenue per campaign/date across ALL collections (for share calc)
    const globalCampaignDateRevenue: Map<string, number> = new Map();

    for (const item of collectionData || []) {
      const key = item.collection_key || 'other';
      if (!collections[key]) {
        collections[key] = {
          attributed_fb_revenue: 0,
          non_fb_revenue: 0,
          unattributed_revenue: 0,
          total_revenue: 0,
          orders: new Set(),
          items_sold: 0,
          campaignDateRevenue: new Map(),
        };
      }

      const revenue = parseFloat(String(item.item_revenue));
      const oa = (item as Record<string, unknown>).order_attributions as Record<string, unknown> | undefined;
      const attrType = oa?.attribution_type as string | undefined;
      const campaignId = oa?.matched_campaign_id as string | undefined;
      const orderDate = oa?.order_date as string | undefined;

      collections[key].total_revenue += revenue;
      collections[key].orders.add(item.order_attribution_id);
      collections[key].items_sold += item.quantity;

      // P1-1: Bucket revenue by attribution type
      if (attrType === 'id_match' || attrType === 'name_match') {
        collections[key].attributed_fb_revenue += revenue;

        // P1-2: Track revenue per campaign/date for spend allocation
        if (campaignId && orderDate) {
          const cdKey = `${campaignId}|${orderDate}`;
          collections[key].campaignDateRevenue.set(
            cdKey,
            (collections[key].campaignDateRevenue.get(cdKey) || 0) + revenue
          );
          globalCampaignDateRevenue.set(
            cdKey,
            (globalCampaignDateRevenue.get(cdKey) || 0) + revenue
          );
        }
      } else if (attrType === 'google_ads' || attrType === 'organic_direct' || attrType === 'facebook_only') {
        collections[key].non_fb_revenue += revenue;
      } else {
        // duplicate_ambiguous, unattributed, or unknown
        collections[key].unattributed_revenue += revenue;
      }
    }

    // ─── Phase 2: Fetch spend data per campaign/date ───
    // Extract unique campaign IDs from the campaign/date keys
    const allCampaignIds = new Set<string>();
    for (const cdKey of globalCampaignDateRevenue.keys()) {
      allCampaignIds.add(cdKey.split('|')[0]);
    }

    // campaign_id → date → spend
    const campaignDateSpend: Map<string, Map<string, number>> = new Map();
    if (allCampaignIds.size > 0) {
      const { data: spendData } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('campaign_id, snapshot_date, spend')
        .in('campaign_id', Array.from(allCampaignIds))
        .gte('snapshot_date', sinceDateStr);

      for (const row of spendData || []) {
        const cid = String(row.campaign_id);
        const date = String(row.snapshot_date);
        if (!campaignDateSpend.has(cid)) {
          campaignDateSpend.set(cid, new Map());
        }
        const dateMap = campaignDateSpend.get(cid)!;
        // Sum spend per campaign/date (in case of multiple snapshots per day)
        dateMap.set(date, (dateMap.get(date) || 0) + (row.spend || 0));
      }
    }

    // ─── Phase 3: Allocate spend per collection using SRS formula ───
    // For each (campaign_id, date), compute this collection's revenue share
    // within that campaign/date, then allocate spend proportionally
    const collectionAllocatedSpend: Record<string, number> = {};

    for (const [collKey, data] of Object.entries(collections)) {
      let totalAllocated = 0;

      for (const [cdKey, collectionRevenue] of data.campaignDateRevenue) {
        const [campaignId, orderDate] = cdKey.split('|');
        const globalRevenue = globalCampaignDateRevenue.get(cdKey) || 0;
        
        if (globalRevenue <= 0) continue;

        // This collection's share of this campaign/date's revenue
        const revenueShare = collectionRevenue / globalRevenue;

        // Get the spend for this campaign on this date
        const dateSpendMap = campaignDateSpend.get(campaignId);
        const daySpend = dateSpendMap?.get(orderDate) || 0;

        // Allocate proportionally
        totalAllocated += daySpend * revenueShare;
      }

      collectionAllocatedSpend[collKey] = totalAllocated;
    }

    // ─── Phase 4: Build response ───
    const result = Object.entries(collections).map(([key, data]) => {
      const allocatedSpend = Math.round((collectionAllocatedSpend[key] || 0) * 100) / 100;
      const fbRevenue = Math.round(data.attributed_fb_revenue * 100) / 100;
      const profit = Math.round((fbRevenue - allocatedSpend) * 100) / 100;
      const roas = allocatedSpend > 0 ? Math.round((fbRevenue / allocatedSpend) * 100) / 100 : null;

      return {
        collection: key,
        // Separated revenue buckets (P1-1)
        attributed_fb_revenue: fbRevenue,
        non_fb_revenue: Math.round(data.non_fb_revenue * 100) / 100,
        unattributed_revenue: Math.round(data.unattributed_revenue * 100) / 100,
        total_revenue: Math.round(data.total_revenue * 100) / 100,
        order_count: data.orders.size,
        items_sold: data.items_sold,
        // Spend & P&L (only from attributed FB orders)
        allocated_spend: allocatedSpend,
        fb_profit: profit,
        fb_roas: roas,
      };
    });

    // Sort by attributed FB revenue descending
    result.sort((a, b) => b.attributed_fb_revenue - a.attributed_fb_revenue);

    // Summary
    const totalFbRevenue = result.reduce((s, r) => s + r.attributed_fb_revenue, 0);
    const totalNonFbRevenue = result.reduce((s, r) => s + r.non_fb_revenue, 0);
    const totalUnattributed = result.reduce((s, r) => s + r.unattributed_revenue, 0);
    const totalRevenue = result.reduce((s, r) => s + r.total_revenue, 0);
    const totalSpend = result.reduce((s, r) => s + r.allocated_spend, 0);
    const totalProfit = result.reduce((s, r) => s + r.fb_profit, 0);

    return NextResponse.json({
      period: `Last ${days} days (since ${sinceDateStr})`,
      methodology: 'Per campaign/date revenue-share spend allocation. ROAS computed on attributed FB orders only.',
      summary: {
        total_revenue: Math.round(totalRevenue * 100) / 100,
        attributed_fb_revenue: Math.round(totalFbRevenue * 100) / 100,
        non_fb_revenue: Math.round(totalNonFbRevenue * 100) / 100,
        unattributed_revenue: Math.round(totalUnattributed * 100) / 100,
        total_fb_spend: Math.round(totalSpend * 100) / 100,
        fb_profit: Math.round(totalProfit * 100) / 100,
        fb_roas: totalSpend > 0 ? Math.round((totalFbRevenue / totalSpend) * 100) / 100 : null,
        collections_count: result.length,
      },
      collections: result,
    });
  } catch (err) {
    return NextResponse.json({
      error: 'Collection P&L failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
