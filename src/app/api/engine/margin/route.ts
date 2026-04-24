import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateDailyMargin } from '@/engine/margin';
import { getAdAccountToday } from '@/lib/timezone';
import { BIZ_DEFAULTS } from '@/lib/businessDefaults';

/**
 * GET /api/engine/margin
 * Returns margin calculation, optionally aggregated over multiple days.
 * Query params: ?days=3&date=YYYY-MM-DD
 * 
 * Smart fallback: If today has no data (early morning / sync delay),
 * automatically falls back to the most recent date with data.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '1', 10);
    let anchorDate = searchParams.get('date') || getAdAccountToday();

    // Smart fallback: check if anchorDate has any data
    if (!searchParams.get('date')) {
      const { count } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', anchorDate)
        .gt('spend', 0);

      if (!count || count === 0) {
        // No data for today — find the most recent date with data
        const { data: latestSnap } = await supabaseAdmin
          .from('campaign_snapshots')
          .select('snapshot_date')
          .gt('spend', 0)
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .single();

        if (latestSnap) {
          anchorDate = latestSnap.snapshot_date;
        }
      }
    }

    // Calculate date range
    const fromDate = new Date(
      new Date(anchorDate).getTime() - (days - 1) * 86400000
    ).toISOString().split('T')[0];

    // Get daily financials (Shopify revenue) for the range
    let shopifyRevenue = 0;
    if (days === 1) {
      const { data: financial } = await supabaseAdmin
        .from('daily_financials')
        .select('shopify_revenue')
        .eq('report_date', anchorDate)
        .limit(1)
        .single();
      shopifyRevenue = financial?.shopify_revenue || 0;
    } else {
      const { data: financials } = await supabaseAdmin
        .from('daily_financials')
        .select('shopify_revenue')
        .gte('report_date', fromDate)
        .lte('report_date', anchorDate);
      shopifyRevenue = financials
        ? financials.reduce((sum: number, f: { shopify_revenue: number }) => sum + (f.shopify_revenue || 0), 0)
        : 0;
    }

    // Get total ad spend from campaign snapshots in range
    // IMPORTANT: Supabase defaults to 1000 rows max. We must raise the limit.
    const { data: snapshots } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend')
      .gte('snapshot_date', fromDate)
      .lte('snapshot_date', anchorDate)
      .gt('spend', 0)
      .limit(10000);

    const totalAdSpend = snapshots
      ? snapshots.reduce((sum: number, s: { spend: number }) => sum + (s.spend || 0), 0)
      : 0;

    // Get margin config from business profile
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('target_margin_min, target_margin_max, avg_cogs_rate')
      .limit(1)
      .single();

    const marginConfig = {
      targetMarginMin: profile?.target_margin_min ?? 0.17,
      targetMarginMax: profile?.target_margin_max ?? 0.20,
      avgCogsRate: profile?.avg_cogs_rate ?? BIZ_DEFAULTS.COGS_RATE,
    };

    const result = calculateDailyMargin(shopifyRevenue, totalAdSpend, marginConfig);

    return NextResponse.json({
      success: true,
      days,
      fromDate,
      toDate: anchorDate,
      margin: result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Margin calculation failed.' },
      { status: 500 }
    );
  }
}
