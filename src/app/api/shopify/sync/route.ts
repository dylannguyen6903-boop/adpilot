import { NextRequest, NextResponse } from 'next/server';
import {
  fetchOrders,
  aggregateOrdersByDay,
  buildCustomerSummaries,
  isShopifyUnauthorizedError,
  type ShopifyConfig,
} from '@/lib/shopify';
import { getShopifyConfigCandidates } from '@/lib/shopifyConfig';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday, getAdAccountDateMinusDays } from '@/lib/timezone';

export const maxDuration = 300; // 5 minutes for Vercel Pro


/**
 * POST /api/shopify/sync
 * Triggers a manual sync of Shopify order data.
 * Fetches recent orders, computes daily financials, updates LTV data.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    let requestConfig: Partial<ShopifyConfig> | undefined;
    try {
      const body = await request.json();
      if (body.storeDomain && body.accessToken) {
        requestConfig = {
          storeDomain: body.storeDomain,
          accessToken: body.accessToken,
        };
      }
    } catch {
      // No body, try DB then env config
    }

    const { data: profileWithCredentials } = await supabaseAdmin
      .from('business_profiles')
      .select('shopify_store_domain, shopify_access_token')
      .limit(1)
      .single();

    const candidates = getShopifyConfigCandidates({
      request: requestConfig,
      database: profileWithCredentials?.shopify_store_domain && profileWithCredentials?.shopify_access_token
        ? {
            storeDomain: profileWithCredentials.shopify_store_domain,
            accessToken: profileWithCredentials.shopify_access_token,
          }
        : undefined,
    });

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'Shopify not configured. Set store domain and access token in Settings.' },
        { status: 400 }
      );
    }

    // Fetch last 7 days of orders
    const today = getAdAccountToday();
    const sevenDaysAgo = getAdAccountDateMinusDays(7);

    let orders;
    let lastUnauthorizedError: unknown = null;
    let usedCredentialSource: ShopifyConfig['source'] = candidates[0]?.source;

    for (const candidate of candidates) {
      try {
        orders = await fetchOrders(sevenDaysAgo, today, candidate);
        usedCredentialSource = candidate.source;
        break;
      } catch (error) {
        if (!isShopifyUnauthorizedError(error)) {
          throw error;
        }

        lastUnauthorizedError = error;
        console.warn(
          `[Shopify sync] ${candidate.source || 'unknown'} credentials rejected for ${candidate.storeDomain}; trying next configured source.`
        );
      }
    }

    if (!orders) {
      throw lastUnauthorizedError || new Error('Shopify sync failed before orders were fetched.');
    }

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
      campaigns_synced: orders.length,
      duration_ms: durationMs,
    });

    return NextResponse.json({
      success: true,
      ordersFetched: orders.length,
      dailySummaries: dailySummaries.length,
      financialsSynced,
      customersSynced,
      credentialSource: usedCredentialSource,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = isShopifyUnauthorizedError(error) ? 401 : 500;

    // Log failed sync (best-effort, ignore errors)
    try {
      await supabaseAdmin.from('sync_logs').insert({
        sync_type: 'SHOPIFY',
        status: 'FAILED',
        error_message: errorMessage,
        duration_ms: durationMs,
      });
    } catch {
      // Ignore logging errors
    }

    return NextResponse.json(
      { error: errorMessage },
      { status }
    );
  }
}
