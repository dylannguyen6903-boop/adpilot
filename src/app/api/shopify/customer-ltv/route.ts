import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday } from '@/lib/timezone';

/**
 * GET /api/shopify/customer-ltv
 * 
 * Phase 2: Customer LTV & First-Touch Attribution
 * TKT-00260: Fixed channel grouping, added coverage metadata, added order names
 * 
 * Query params:
 *   days=90 (lookback window, default 90, max 365)
 *   date=YYYY-MM-DD (anchor date, defaults to ad-account today)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '90', 10), 1), 365);

    // Anchor to ad-account timezone
    const anchorDate = searchParams.get('date') || getAdAccountToday();
    const anchor = new Date(anchorDate + 'T00:00:00Z');
    const from = new Date(anchor.getTime() - (days - 1) * 86400000);
    const fromDateStr = from.toISOString().split('T')[0];
    const toDateStr = anchorDate;

    // ─── Data Coverage Check (TKT-00260 P1-3) ───
    // Count attributed orders vs estimated total from daily_financials
    const { count: attributedCount } = await supabaseAdmin
      .from('order_attributions')
      .select('*', { count: 'exact', head: true })
      .gte('order_date', fromDateStr)
      .lte('order_date', toDateStr);

    const { data: financials } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_orders')
      .gte('report_date', fromDateStr)
      .lte('report_date', toDateStr);

    const estimatedTotalOrders = (financials || []).reduce(
      (s, f) => s + (parseInt(String(f.shopify_orders)) || 0), 0
    );

    // Find last sync timestamp
    const { data: lastSync } = await supabaseAdmin
      .from('order_attributions')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    const coverage = {
      attributed_orders: attributedCount || 0,
      estimated_total_orders: estimatedTotalOrders,
      coverage_percent: estimatedTotalOrders > 0
        ? Math.round(((attributedCount || 0) / estimatedTotalOrders) * 100)
        : 0,
      last_sync: lastSync?.updated_at || null,
    };

    // ─── Fetch all orders with customer email in date range ───
    // TKT-00262: Backward-compatible select. Try with display_email, fall back without it
    let orders;
    let ordError;
    {
      const res = await supabaseAdmin
        .from('order_attributions')
        .select('customer_email, customer_display_email, shopify_order_name, total_revenue, order_date, attribution_type, matched_campaign_id, matched_campaign_name, is_returning_customer')
        .not('customer_email', 'is', null)
        .gte('order_date', fromDateStr)
        .lte('order_date', toDateStr);

      if (res.error?.message?.includes('customer_display_email')) {
        // Column doesn't exist yet (pre-migration), select without it
        const fallback = await supabaseAdmin
          .from('order_attributions')
          .select('customer_email, shopify_order_name, total_revenue, order_date, attribution_type, matched_campaign_id, matched_campaign_name, is_returning_customer')
          .not('customer_email', 'is', null)
          .gte('order_date', fromDateStr)
          .lte('order_date', toDateStr);
        orders = fallback.data;
        ordError = fallback.error;
      } else {
        orders = res.data;
        ordError = res.error;
      }
    }

    if (ordError) {
      return NextResponse.json({ error: ordError.message }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({
        period: days === 1 ? toDateStr : `${fromDateStr} → ${toDateStr} (${days} days)`,
        coverage,
        summary: {
          total_customers: 0, total_orders: 0, avg_ltv: 0,
          avg_orders_per_customer: 0, repeat_rate: 0, total_revenue: 0,
          repeat_customers: 0, total_fb_spend: 0, fb_cac: 0, fb_ltv_cac_ratio: 0,
        },
        cohorts: [], top_customers: [], channel_ltv: [],
      });
    }

    // ─── Aggregate per customer ───
    interface CustomerData {
      email: string;
      display_email: string | null;
      orders: Array<{
        revenue: number;
        date: string;
        attribution_type: string;
        campaign_id: string | null;
        campaign_name: string | null;
        order_name: string | null;
      }>;
      total_revenue: number;
    }

    const customerMap = new Map<string, CustomerData>();

    for (const ord of orders) {
      const email = ord.customer_email as string;
      if (!customerMap.has(email)) {
        customerMap.set(email, {
          email,
          display_email: ((ord as Record<string, unknown>).customer_display_email as string) || null,
          orders: [],
          total_revenue: 0,
        });
      }
      const cust = customerMap.get(email)!;
      const rev = parseFloat(String(ord.total_revenue)) || 0;
      cust.orders.push({
        revenue: rev,
        date: ord.order_date,
        attribution_type: ord.attribution_type,
        campaign_id: ord.matched_campaign_id,
        campaign_name: ord.matched_campaign_name,
        order_name: ord.shopify_order_name,
      });
      cust.total_revenue += rev;
    }

    // Sort each customer's orders by date (ascending) to find first-touch
    for (const cust of customerMap.values()) {
      cust.orders.sort((a, b) => a.date.localeCompare(b.date));
    }

    // ─── Channel classification helper (TKT-00260 fix) ───
    function classifyChannel(attrType: string): string {
      switch (attrType) {
        case 'id_match':
        case 'name_match':
          return 'FB Attributed';
        case 'facebook_only':
          return 'FB Unmatched';  // TKT-00260: Was incorrectly grouped under Organic
        case 'google_ads':
          return 'Google Ads';
        case 'google_organic':
          return 'Google Organic';
        case 'organic_direct':
          return 'Organic / Direct';
        case 'duplicate_ambiguous':
          return 'FB Ambiguous';
        case 'unmatched_utm':
          return 'Unmatched UTM';
        default:
          return 'Unattributed';
      }
    }

    // ─── Summary KPIs ───
    const customers = Array.from(customerMap.values());
    const totalCustomers = customers.length;
    const totalOrders = orders.length;
    const totalRevenue = customers.reduce((s, c) => s + c.total_revenue, 0);
    const avgLtv = totalRevenue / totalCustomers;
    const avgOrdersPerCustomer = totalOrders / totalCustomers;
    const repeatCustomers = customers.filter(c => c.orders.length > 1).length;
    const repeatRate = totalCustomers > 0 ? repeatCustomers / totalCustomers : 0;

    // ─── First-Touch Channel LTV ───
    interface ChannelLtv {
      channel: string;
      customer_count: number;
      total_revenue: number;
      avg_ltv: number;
      avg_orders: number;
      repeat_rate: number;
    }

    const channelMap = new Map<string, { customers: CustomerData[] }>();

    for (const cust of customers) {
      const channel = classifyChannel(cust.orders[0].attribution_type);
      if (!channelMap.has(channel)) {
        channelMap.set(channel, { customers: [] });
      }
      channelMap.get(channel)!.customers.push(cust);
    }

    const channelLtv: ChannelLtv[] = [];
    for (const [channel, data] of channelMap) {
      const custCount = data.customers.length;
      const chRevenue = data.customers.reduce((s, c) => s + c.total_revenue, 0);
      const chRepeat = data.customers.filter(c => c.orders.length > 1).length;
      const chTotalOrders = data.customers.reduce((s, c) => s + c.orders.length, 0);
      channelLtv.push({
        channel,
        customer_count: custCount,
        total_revenue: Math.round(chRevenue * 100) / 100,
        avg_ltv: Math.round((chRevenue / custCount) * 100) / 100,
        avg_orders: Math.round((chTotalOrders / custCount) * 100) / 100,
        repeat_rate: Math.round((chRepeat / custCount) * 10000) / 100,
      });
    }
    channelLtv.sort((a, b) => b.total_revenue - a.total_revenue);

    // ─── Monthly Cohort Analysis ───
    interface CohortData {
      cohort_month: string;
      customer_count: number;
      total_revenue: number;
      avg_ltv: number;
      repeat_count: number;
      repeat_rate: number;
      avg_orders: number;
    }

    const cohortMap = new Map<string, CustomerData[]>();
    for (const cust of customers) {
      const cohortMonth = cust.orders[0].date.substring(0, 7);
      if (!cohortMap.has(cohortMonth)) cohortMap.set(cohortMonth, []);
      cohortMap.get(cohortMonth)!.push(cust);
    }

    const cohorts: CohortData[] = [];
    for (const [month, custs] of cohortMap) {
      const count = custs.length;
      const rev = custs.reduce((s, c) => s + c.total_revenue, 0);
      const repeats = custs.filter(c => c.orders.length > 1).length;
      const totalOrd = custs.reduce((s, c) => s + c.orders.length, 0);
      cohorts.push({
        cohort_month: month,
        customer_count: count,
        total_revenue: Math.round(rev * 100) / 100,
        avg_ltv: Math.round((rev / count) * 100) / 100,
        repeat_count: repeats,
        repeat_rate: Math.round((repeats / count) * 10000) / 100,
        avg_orders: Math.round((totalOrd / count) * 100) / 100,
      });
    }
    cohorts.sort((a, b) => a.cohort_month.localeCompare(b.cohort_month));

    // ─── Top Customers (TKT-00260: show order name + masked email) ───
    const topCustomers = customers
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20)
      .map(c => {
        const first = c.orders[0];
        const last = c.orders[c.orders.length - 1];
        return {
          display_email: c.display_email || c.email.substring(0, 8) + '...',
          first_order_name: first.order_name,
          last_order_name: last.order_name,
          order_count: c.orders.length,
          lifetime_revenue: Math.round(c.total_revenue * 100) / 100,
          first_order_date: first.date,
          last_order_date: last.date,
          first_touch_channel: classifyChannel(first.attribution_type),
          first_campaign: first.campaign_name || null,
        };
      });

    // ─── Fetch FB spend for LTV/CAC ───
    const { data: spendData } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend')
      .gte('snapshot_date', fromDateStr)
      .lte('snapshot_date', toDateStr);

    const totalSpend = (spendData || []).reduce((s, r) => s + (parseFloat(String(r.spend)) || 0), 0);
    // FB-acquired = id_match + name_match customers
    const fbCustomers = channelLtv.find(c => c.channel === 'FB Attributed')?.customer_count || 0;
    const cac = fbCustomers > 0 ? totalSpend / fbCustomers : 0;
    const fbAvgLtv = channelLtv.find(c => c.channel === 'FB Attributed')?.avg_ltv || 0;
    const ltvCacRatio = cac > 0 ? fbAvgLtv / cac : 0;

    return NextResponse.json({
      period: days === 1 ? toDateStr : `${fromDateStr} → ${toDateStr} (${days} days)`,
      methodology: 'First-touch attribution from earliest order. Google Ads requires paid utm_medium (cpc/ppc). facebook_only = FB traffic without matched campaign. LTV = sum of all order revenue per customer.',
      coverage,
      summary: {
        total_customers: totalCustomers,
        total_orders: totalOrders,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        avg_ltv: Math.round(avgLtv * 100) / 100,
        avg_orders_per_customer: Math.round(avgOrdersPerCustomer * 100) / 100,
        repeat_rate: Math.round(repeatRate * 10000) / 100,
        repeat_customers: repeatCustomers,
        total_fb_spend: Math.round(totalSpend * 100) / 100,
        fb_cac: Math.round(cac * 100) / 100,
        fb_ltv_cac_ratio: Math.round(ltvCacRatio * 100) / 100,
      },
      channel_ltv: channelLtv,
      cohorts,
      top_customers: topCustomers,
    });
  } catch (err) {
    console.error('Customer LTV error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
