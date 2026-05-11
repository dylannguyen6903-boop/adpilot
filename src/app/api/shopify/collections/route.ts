import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/shopify/collections
 * 
 * Returns Collection P&L data:
 * - Revenue per collection (billiards, bowling, darts, fishing, other)
 * - Attributed ad spend per collection (via revenue share allocation)
 * - Profit and ROAS per collection
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

    // Fetch attribution items grouped by collection
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

    // Aggregate by collection
    const collections: Record<string, {
      revenue: number;
      orders: Set<string>;
      items_sold: number;
      attributed_orders: number;
      campaign_ids: Set<string>;
    }> = {};

    for (const item of collectionData || []) {
      const key = item.collection_key || 'other';
      if (!collections[key]) {
        collections[key] = { revenue: 0, orders: new Set(), items_sold: 0, attributed_orders: 0, campaign_ids: new Set() };
      }
      collections[key].revenue += parseFloat(String(item.item_revenue));
      collections[key].orders.add(item.order_attribution_id);
      collections[key].items_sold += item.quantity;
      
      const oa = (item as Record<string, unknown>).order_attributions as Record<string, unknown> | undefined;
      if (oa?.attribution_type === 'id_match' || oa?.attribution_type === 'name_match') {
        collections[key].attributed_orders++;
        if (oa?.matched_campaign_id) {
          collections[key].campaign_ids.add(String(oa.matched_campaign_id));
        }
      }
    }

    // Fetch spend data for attributed campaigns
    const allCampaignIds = new Set<string>();
    for (const col of Object.values(collections)) {
      for (const id of col.campaign_ids) allCampaignIds.add(id);
    }

    let campaignSpend: Record<string, number> = {};
    if (allCampaignIds.size > 0) {
      const { data: spendData } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('campaign_id, spend')
        .in('campaign_id', Array.from(allCampaignIds))
        .gte('snapshot_date', sinceDateStr);

      for (const row of spendData || []) {
        const id = String(row.campaign_id);
        campaignSpend[id] = (campaignSpend[id] || 0) + (row.spend || 0);
      }
    }

    // Calculate spend allocation per collection using revenue share
    const totalAttributedRevenue = Object.values(collections)
      .reduce((sum, c) => sum + c.revenue, 0);

    const result = Object.entries(collections).map(([key, data]) => {
      const revenueShare = totalAttributedRevenue > 0 
        ? data.revenue / totalAttributedRevenue 
        : 0;
      
      // Total spend across all attributed campaigns
      let totalSpend = 0;
      for (const id of data.campaign_ids) {
        totalSpend += campaignSpend[id] || 0;
      }

      // Allocated spend based on revenue share
      const allocatedSpend = Math.round(totalSpend * revenueShare * 100) / 100;
      const profit = Math.round((data.revenue - allocatedSpend) * 100) / 100;
      const roas = allocatedSpend > 0 ? Math.round((data.revenue / allocatedSpend) * 100) / 100 : null;

      return {
        collection: key,
        revenue: Math.round(data.revenue * 100) / 100,
        order_count: data.orders.size,
        items_sold: data.items_sold,
        allocated_spend: allocatedSpend,
        profit,
        roas,
        campaigns_count: data.campaign_ids.size,
      };
    });

    // Sort by revenue descending
    result.sort((a, b) => b.revenue - a.revenue);

    // Summary
    const totalRevenue = result.reduce((s, r) => s + r.revenue, 0);
    const totalSpend = result.reduce((s, r) => s + r.allocated_spend, 0);
    const totalProfit = result.reduce((s, r) => s + r.profit, 0);

    return NextResponse.json({
      period: `Last ${days} days (since ${sinceDateStr})`,
      summary: {
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_spend: Math.round(totalSpend * 100) / 100,
        total_profit: Math.round(totalProfit * 100) / 100,
        overall_roas: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : null,
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
