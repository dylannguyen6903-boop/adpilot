import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday } from '@/lib/timezone';

/**
 * GET /api/shopify/customer-ltv
 * 
 * Phase 2: Customer LTV & First-Touch Attribution
 * 
 * Aggregates customer-level metrics from order_attributions:
 * - Lifetime revenue, order count, repeat rate
 * - First-touch campaign attribution (which channel acquired the customer)
 * - Monthly cohort analysis
 * - LTV/CAC ratio by acquisition channel
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

    // ─── Fetch all orders with customer email in date range ───
    const { data: orders, error: ordError } = await supabaseAdmin
      .from('order_attributions')
      .select('customer_email, total_revenue, order_date, attribution_type, matched_campaign_id, matched_campaign_name, is_returning_customer')
      .not('customer_email', 'is', null)
      .gte('order_date', fromDateStr)
      .lte('order_date', toDateStr);

    if (ordError) {
      return NextResponse.json({ error: ordError.message }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({
        period: days === 1 ? toDateStr : `${fromDateStr} → ${toDateStr} (${days} days)`,
        summary: {
          total_customers: 0,
          total_orders: 0,
          avg_ltv: 0,
          avg_orders_per_customer: 0,
          repeat_rate: 0,
          total_revenue: 0,
        },
        cohorts: [],
        top_customers: [],
        channel_ltv: [],
      });
    }

    // ─── Aggregate per customer ───
    interface CustomerData {
      email: string;
      orders: Array<{
        revenue: number;
        date: string;
        attribution_type: string;
        campaign_id: string | null;
        campaign_name: string | null;
      }>;
      total_revenue: number;
    }

    const customerMap = new Map<string, CustomerData>();

    for (const ord of orders) {
      const email = ord.customer_email as string;
      if (!customerMap.has(email)) {
        customerMap.set(email, { email, orders: [], total_revenue: 0 });
      }
      const cust = customerMap.get(email)!;
      const rev = parseFloat(String(ord.total_revenue)) || 0;
      cust.orders.push({
        revenue: rev,
        date: ord.order_date,
        attribution_type: ord.attribution_type,
        campaign_id: ord.matched_campaign_id,
        campaign_name: ord.matched_campaign_name,
      });
      cust.total_revenue += rev;
    }

    // Sort each customer's orders by date (ascending) to find first-touch
    for (const cust of customerMap.values()) {
      cust.orders.sort((a, b) => a.date.localeCompare(b.date));
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
    // Group customers by their first order's attribution type
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
      const firstOrder = cust.orders[0];
      let channel = 'Unattributed';
      if (firstOrder.attribution_type === 'id_match' || firstOrder.attribution_type === 'name_match') {
        channel = 'FB Attributed';
      } else if (firstOrder.attribution_type === 'google_ads') {
        channel = 'Google Ads';
      } else if (firstOrder.attribution_type === 'organic_direct' || firstOrder.attribution_type === 'facebook_only') {
        channel = 'Organic / Direct';
      }

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
    // Cohort = month of customer's first order
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
      const firstDate = cust.orders[0].date; // YYYY-MM-DD
      const cohortMonth = firstDate.substring(0, 7); // YYYY-MM
      if (!cohortMap.has(cohortMonth)) {
        cohortMap.set(cohortMonth, []);
      }
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

    // ─── Top Customers ───
    const topCustomers = customers
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20)
      .map(c => {
        const first = c.orders[0];
        return {
          email_hash: c.email.substring(0, 8) + '...',
          order_count: c.orders.length,
          lifetime_revenue: Math.round(c.total_revenue * 100) / 100,
          first_order_date: first.date,
          last_order_date: c.orders[c.orders.length - 1].date,
          first_touch_channel: first.attribution_type === 'id_match' || first.attribution_type === 'name_match'
            ? 'FB Attributed' : first.attribution_type === 'google_ads'
              ? 'Google Ads' : first.attribution_type === 'organic_direct' || first.attribution_type === 'facebook_only'
                ? 'Organic / Direct' : 'Unattributed',
          first_campaign: first.campaign_name || null,
        };
      });

    // ─── Fetch FB spend for LTV/CAC ───
    // Calculate total spend in the period for LTV/CAC ratio
    const { data: spendData } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend')
      .gte('snapshot_date', fromDateStr)
      .lte('snapshot_date', toDateStr);

    const totalSpend = (spendData || []).reduce((s, r) => s + (parseFloat(String(r.spend)) || 0), 0);
    const fbCustomers = channelLtv.find(c => c.channel === 'FB Attributed')?.customer_count || 0;
    const cac = fbCustomers > 0 ? totalSpend / fbCustomers : 0;
    const fbAvgLtv = channelLtv.find(c => c.channel === 'FB Attributed')?.avg_ltv || 0;
    const ltvCacRatio = cac > 0 ? fbAvgLtv / cac : 0;

    return NextResponse.json({
      period: days === 1 ? toDateStr : `${fromDateStr} → ${toDateStr} (${days} days)`,
      methodology: 'First-touch attribution from earliest order. LTV = sum of all order revenue per customer email. CAC = total FB spend / FB-acquired customers.',
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
