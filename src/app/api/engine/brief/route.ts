import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday } from '@/lib/timezone';

/**
 * GET /api/engine/brief
 * Morning Brief: 7-day daily metrics, MTD, forecast, scenarios, alerts.
 * All calculations are pure math — no AI needed.
 */
export async function GET() {
  try {
    // 1. Determine dates
    let anchorDate = getAdAccountToday();

    // Smart fallback: if today has no data, use latest date
    const { count: todayCount } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('snapshot_date', anchorDate)
      .gt('spend', 0);

    if (!todayCount || todayCount === 0) {
      const { data: latest } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('snapshot_date')
        .gt('spend', 0)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();
      if (latest) anchorDate = latest.snapshot_date;
    }

    const sevenDaysAgo = new Date(
      new Date(anchorDate).getTime() - 6 * 86400000
    ).toISOString().split('T')[0];

    const monthStart = anchorDate.slice(0, 7) + '-01';

    // 2. Get business profile
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .limit(1)
      .single();

    const cogsRate = profile?.avg_cogs_rate ?? 0.32;
    const monthlyTarget = profile?.monthly_profit_target ?? 15000;

    // 3. Parallel queries
    const [snapshotsRes, financialsRes, mtdFinancialsRes] = await Promise.all([
      // 7-day snapshots
      supabaseAdmin
        .from('campaign_snapshots')
        .select('snapshot_date, spend, conversions, revenue_fb, impressions, clicks, add_to_cart, initiate_checkout, daily_budget, campaign_id, campaign_name')
        .gte('snapshot_date', sevenDaysAgo)
        .lte('snapshot_date', anchorDate)
        .gt('spend', 0)
        .limit(10000),
      // 7-day financials
      supabaseAdmin
        .from('daily_financials')
        .select('report_date, shopify_revenue')
        .gte('report_date', sevenDaysAgo)
        .lte('report_date', anchorDate)
        .order('report_date', { ascending: true }),
      // MTD financials
      supabaseAdmin
        .from('daily_financials')
        .select('report_date, shopify_revenue')
        .gte('report_date', monthStart)
        .lte('report_date', anchorDate),
    ]);

    const snapshots = snapshotsRes.data || [];
    const financials = financialsRes.data || [];
    const mtdFinancials = mtdFinancialsRes.data || [];

    // 4. Aggregate daily metrics
    const dailyMap = new Map<string, {
      spend: number; orders: number; revenue: number;
      impressions: number; clicks: number; atc: number; ic: number;
    }>();

    // Initialize 7 days
    for (let i = 0; i < 7; i++) {
      const d = new Date(new Date(anchorDate).getTime() - i * 86400000)
        .toISOString().split('T')[0];
      dailyMap.set(d, { spend: 0, orders: 0, revenue: 0, impressions: 0, clicks: 0, atc: 0, ic: 0 });
    }

    for (const s of snapshots) {
      const day = dailyMap.get(s.snapshot_date);
      if (day) {
        day.spend += s.spend || 0;
        day.orders += s.conversions || 0;
        day.impressions += s.impressions || 0;
        day.clicks += s.clicks || 0;
        day.atc += s.add_to_cart || 0;
        day.ic += s.initiate_checkout || 0;
      }
    }

    // Merge Shopify revenue
    const revenueMap = new Map<string, number>();
    for (const f of financials) {
      revenueMap.set(f.report_date, f.shopify_revenue || 0);
    }

    // Build daily array (oldest → newest)
    const dates = Array.from(dailyMap.keys()).sort();
    const daily = dates.map(date => {
      const d = dailyMap.get(date)!;
      const rev = revenueMap.get(date) || 0;
      const profit = rev * (1 - cogsRate) - d.spend;
      const margin = rev > 0 ? profit / rev : 0;
      return {
        date,
        profit: Math.round(profit * 100) / 100,
        spend: Math.round(d.spend * 100) / 100,
        revenue: Math.round(rev * 100) / 100,
        orders: d.orders,
        cpa: d.orders > 0 ? Math.round((d.spend / d.orders) * 100) / 100 : null,
        margin: Math.round(margin * 1000) / 1000,
        impressions: d.impressions,
        clicks: d.clicks,
        atc: d.atc,
        ic: d.ic,
      };
    });

    // 5. Yesterday vs day before
    const yesterday = daily.length >= 1 ? daily[daily.length - 1] : null;
    const dayBefore = daily.length >= 2 ? daily[daily.length - 2] : null;

    // 6. MTD — full query for spend (may extend beyond 7-day window)
    const { data: mtdSnapshots } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend, conversions')
      .gte('snapshot_date', monthStart)
      .lte('snapshot_date', anchorDate)
      .gt('spend', 0)
      .limit(10000);

    const mtdTotalSpend = mtdSnapshots?.reduce((s, r) => s + (r.spend || 0), 0) || 0;
    const mtdTotalOrders = mtdSnapshots?.reduce((s, r) => s + (r.conversions || 0), 0) || 0;
    const mtdTotalRevenue = mtdFinancials.reduce((s, r) => s + (r.shopify_revenue || 0), 0);
    const mtdProfit = mtdTotalRevenue * (1 - cogsRate) - mtdTotalSpend;

    const dayOfMonth = new Date(anchorDate).getDate();
    const daysInMonth = new Date(
      new Date(anchorDate).getFullYear(),
      new Date(anchorDate).getMonth() + 1,
      0
    ).getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    // 7. Forecast
    const profitDays = daily.filter(d => d.revenue > 0 || d.spend > 0);
    const avgDailyProfit7d = profitDays.length > 0
      ? profitDays.reduce((s, d) => s + d.profit, 0) / profitDays.length
      : 0;
    const projectedMonthEnd = mtdProfit + avgDailyProfit7d * daysRemaining;
    const gap = monthlyTarget - projectedMonthEnd;
    const dailyNeeded = daysRemaining > 0 ? (monthlyTarget - mtdProfit) / daysRemaining : 0;

    // 8. Alerts (max 3, sorted by severity)
    // Scenarios & TODOs are now calculated client-side from Plan engine actions
    const alerts: Array<{ type: 'danger' | 'warning' | 'info'; message: string; priority: number }> = [];

    if (yesterday && yesterday.profit < 0) {
      alerts.push({ type: 'danger', message: `Hôm qua LỖ $${Math.abs(yesterday.profit).toFixed(0)}`, priority: 1 });
    }
    if (projectedMonthEnd < monthlyTarget) {
      alerts.push({ type: 'danger', message: `Dự báo cuối tháng: $${projectedMonthEnd.toFixed(0)} — thiếu $${gap.toFixed(0)} so với target`, priority: 2 });
    }
    if (yesterday && yesterday.margin < 0.17 && yesterday.margin > 0) {
      alerts.push({ type: 'warning', message: `Margin hôm qua ${(yesterday.margin * 100).toFixed(1)}% — dưới target 17%`, priority: 3 });
    }
    if (yesterday && dayBefore && yesterday.cpa && dayBefore.cpa) {
      const cpaChange = (yesterday.cpa - dayBefore.cpa) / dayBefore.cpa;
      if (cpaChange > 0.3) {
        alerts.push({ type: 'warning', message: `CPA hôm qua $${yesterday.cpa.toFixed(0)} — tăng ${(cpaChange * 100).toFixed(0)}% vs hôm kia`, priority: 4 });
      }
    }
    alerts.sort((a, b) => a.priority - b.priority);
    const topAlerts = alerts.slice(0, 3).map(({ type, message }) => ({ type, message }));

    return NextResponse.json({
      success: true,
      date: anchorDate,
      yesterday,
      dayBefore,
      daily,
      mtd: {
        profit: Math.round(mtdProfit * 100) / 100,
        spend: Math.round(mtdTotalSpend * 100) / 100,
        revenue: Math.round(mtdTotalRevenue * 100) / 100,
        orders: mtdTotalOrders,
        avgCpa: mtdTotalOrders > 0 ? Math.round((mtdTotalSpend / mtdTotalOrders) * 100) / 100 : null,
        daysElapsed: dayOfMonth,
        daysRemaining,
      },
      forecast: {
        avgDailyProfit7d: Math.round(avgDailyProfit7d * 100) / 100,
        projectedMonthEnd: Math.round(projectedMonthEnd),
        target: monthlyTarget,
        gap: Math.round(gap),
        onTrack: projectedMonthEnd >= monthlyTarget,
        dailyNeeded: Math.round(dailyNeeded),
      },
      alerts: topAlerts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Brief generation failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
