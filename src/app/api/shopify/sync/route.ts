import { NextRequest, NextResponse } from 'next/server';
import {
  fetchOrders,
  aggregateOrdersByDay,
  buildCustomerSummaries,
  getShopifyConfig,
  isShopifyConfigured,
} from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday, getAdAccountDateMinusDays } from '@/lib/timezone';

/**
 * POST /api/shopify/sync
 * Triggers a manual sync of Shopify order data.
 * Fetches recent orders, computes daily financials, updates LTV data.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    let customConfig;
    try {
      const body = await request.json();
      if (body.storeDomain && body.accessToken) {
        customConfig = {
          storeDomain: body.storeDomain,
          accessToken: body.accessToken,
        };
      }
    } catch {
      // No body, use env config
    }

    const config = customConfig || getShopifyConfig();
    if (!isShopifyConfigured(config)) {
      return NextResponse.json(
        { error: 'Shopify not configured. Set store domain and access token in Settings.' },
        { status: 400 }
      );
    }

    // Fetch last 7 days of orders
    const today = getAdAccountToday();
    const sevenDaysAgo = getAdAccountDateMinusDays(7);

    const orders = await fetchOrders(sevenDaysAgo, today, config);
    const dailySummaries = aggregateOrdersByDay(orders);
    const customerSummaries = buildCustomerSummaries(orders);

    // Get profile_id for upserts
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .limit(1)
      .single();
    const profileId = profile?.id;

    // Upsert daily financials
    let financialsSynced = 0;
    for (const day of dailySummaries) {
      const { error } = await supabaseAdmin
        .from('daily_financials')
        .upsert(
          {
            profile_id: profileId,
            report_date: day.date,
            shopify_revenue: day.revenue,
            shopify_orders: day.orderCount,
            shopify_aov: day.aov,
            shopify_actual_orders: day.orderCount,
          },
          { onConflict: 'profile_id,report_date' }
        );

      if (!error) financialsSynced++;
      else console.error('daily_financials upsert error:', JSON.stringify(error));
    }

    // Upsert customer LTV data
    let customersSynced = 0;
    for (const customer of customerSummaries) {
      const { error } = await supabaseAdmin
        .from('customer_ltv')
        .upsert(
          {
            profile_id: profileId,
            customer_email: customer.email,
            first_order_date: customer.firstOrderDate.split('T')[0],
            total_orders: customer.totalOrders,
            total_revenue: customer.totalRevenue,
            is_returning: customer.isReturning,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'profile_id,customer_email' }
        );

      if (!error) customersSynced++;
    }

    // Log sync result
    const durationMs = Date.now() - startTime;
    await supabaseAdmin.from('sync_logs').insert({
      sync_type: 'SHOPIFY',
      status: 'SUCCESS',
      orders_synced: orders.length,
      duration_ms: durationMs,
    });

    return NextResponse.json({
      success: true,
      ordersFetched: orders.length,
      dailySummaries: dailySummaries.length,
      financialsSynced,
      customersSynced,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log failed sync (best-effort, ignore errors)
    try {
      await supabaseAdmin.from('sync_logs').insert({
        sync_type: 'SHOPIFY',
        status: 'FAILED',
        error_message: String(error),
        duration_ms: durationMs,
      });
    } catch {
      // Ignore logging errors
    }

    return NextResponse.json(
      { error: `Shopify sync failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
