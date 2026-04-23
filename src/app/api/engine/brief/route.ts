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

    const targetCpa = profile?.target_cpa ?? 42;
    const cogsRate = profile?.avg_cogs_rate ?? 0.32;
    const monthlyTarget = profile?.monthly_profit_target ?? 15000;
    const aov = profile?.aov ?? 86;

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

    // 6. MTD calculations
    const mtdSpend = (() => {
      // Need MTD spend from snapshots
      const mtdSnaps = snapshots.filter(s => s.snapshot_date >= monthStart);
      // But we also need older MTD data not in 7-day window
      return 0; // Will calculate below
    })();

    // Full MTD query for spend
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

    // 8. Scenarios (pure math)
    // Get plan actions for scenario calculations
    const killCamps = new Map<string, { budget: number; spend7d: number; name: string }>();
    const scaleCamps: Array<{ orders7d: number; profitPerOrder: number; budget: number; name: string }> = [];

    // Aggregate per-campaign 7d data
    const campAgg = new Map<string, {
      spend7d: number; orders7d: number; revenue7d: number;
      budget: number; name: string;
    }>();

    for (const s of snapshots) {
      const existing = campAgg.get(s.campaign_id);
      if (existing) {
        existing.spend7d += s.spend || 0;
        existing.orders7d += s.conversions || 0;
        existing.revenue7d += s.revenue_fb || 0;
        existing.budget = s.daily_budget || existing.budget;
      } else {
        campAgg.set(s.campaign_id, {
          spend7d: s.spend || 0,
          orders7d: s.conversions || 0,
          revenue7d: s.revenue_fb || 0,
          budget: s.daily_budget || 0,
          name: s.campaign_name,
        });
      }
    }

    // Identify kill candidates: spend7d > $50 AND (no orders OR CPA > targetCpa * 2)
    let killSavings = 0;
    let killSpend7d = 0;
    let killCount = 0;
    for (const [, c] of campAgg) {
      const cpa = c.orders7d > 0 ? c.spend7d / c.orders7d : Infinity;
      const profitPerOrder = c.orders7d > 0 ? (aov * (1 - cogsRate)) - cpa : -Infinity;
      if (c.spend7d > 50 && (c.orders7d === 0 || profitPerOrder < -10)) {
        killSavings += c.budget;
        killSpend7d += c.spend7d;
        killCount++;
      }
    }

    // Identify scale candidates: CPA < targetCpa AND profitPerOrder > 0
    let scaleExtraProfit = 0;
    let scaleCount = 0;
    for (const [, c] of campAgg) {
      if (c.orders7d >= 2) {
        const cpa = c.spend7d / c.orders7d;
        const profitPerOrder = (aov * (1 - cogsRate)) - cpa;
        if (cpa < targetCpa && profitPerOrder > 0) {
          // Scale +20% budget → estimate +14% more orders (0.7x conservative)
          const dailyOrders = c.orders7d / 7;
          const extraOrders = dailyOrders * 0.14;
          scaleExtraProfit += extraOrders * profitPerOrder;
          scaleCount++;
        }
      }
    }

    // CPA optimization scenario
    const total7dSpend = daily.reduce((s, d) => s + d.spend, 0);
    const total7dOrders = daily.reduce((s, d) => s + d.orders, 0);
    const currentAvgCpa = total7dOrders > 0 ? total7dSpend / total7dOrders : 0;
    const cpaSavingsPerDay = total7dOrders > 0
      ? ((currentAvgCpa - targetCpa) * (total7dOrders / 7))
      : 0;

    const scenarios = [];

    if (killCount > 0) {
      const projected = mtdProfit + (avgDailyProfit7d + killSavings) * daysRemaining;
      scenarios.push({
        id: 'cut-losses',
        title: `Cắt lỗ: Tắt ${killCount} camp không hiệu quả`,
        description: `Tiết kiệm $${killSavings.toFixed(0)}/ngày (đã chi $${killSpend7d.toFixed(0)} trong 7 ngày mà lỗ)`,
        impact: Math.round(projected),
        savings: Math.round(killSavings),
        effort: 'low' as const,
      });
    }

    if (scaleCount > 0) {
      const projected = mtdProfit + (avgDailyProfit7d + scaleExtraProfit) * daysRemaining;
      scenarios.push({
        id: 'scale-winners',
        title: `Scale: Tăng budget ${scaleCount} camp tốt nhất +20%`,
        description: `Ước tính thêm ~$${scaleExtraProfit.toFixed(0)}/ngày profit (bảo thủ 0.7x)`,
        impact: Math.round(projected),
        savings: Math.round(scaleExtraProfit),
        effort: 'medium' as const,
      });
    }

    if (currentAvgCpa > targetCpa && cpaSavingsPerDay > 0) {
      const projected = mtdProfit + (avgDailyProfit7d + cpaSavingsPerDay) * daysRemaining;
      scenarios.push({
        id: 'optimize-cpa',
        title: `Tối ưu CPA: $${currentAvgCpa.toFixed(0)} → $${targetCpa}`,
        description: `Nếu đạt target CPA, tiết kiệm ~$${cpaSavingsPerDay.toFixed(0)}/ngày chi phí ads`,
        impact: Math.round(projected),
        savings: Math.round(cpaSavingsPerDay),
        effort: 'high' as const,
      });
    }

    // 9. Alerts (max 3, sorted by severity)
    const alerts: Array<{ type: 'danger' | 'warning' | 'info'; message: string; priority: number }> = [];

    if (yesterday && yesterday.profit < 0) {
      alerts.push({ type: 'danger', message: `Hôm qua LỖ $${Math.abs(yesterday.profit).toFixed(0)}`, priority: 1 });
    }

    if (!projectedMonthEnd || projectedMonthEnd < monthlyTarget) {
      alerts.push({
        type: 'danger',
        message: `Dự báo cuối tháng: $${projectedMonthEnd.toFixed(0)} — thiếu $${gap.toFixed(0)} so với target`,
        priority: 2,
      });
    }

    if (yesterday && yesterday.margin < 0.17 && yesterday.margin > 0) {
      alerts.push({
        type: 'warning',
        message: `Margin hôm qua ${(yesterday.margin * 100).toFixed(1)}% — dưới target 17%`,
        priority: 3,
      });
    }

    if (yesterday && dayBefore && yesterday.cpa && dayBefore.cpa) {
      const cpaChange = (yesterday.cpa - dayBefore.cpa) / dayBefore.cpa;
      if (cpaChange > 0.3) {
        alerts.push({
          type: 'warning',
          message: `CPA hôm qua $${yesterday.cpa.toFixed(0)} — tăng ${(cpaChange * 100).toFixed(0)}% vs hôm kia`,
          priority: 4,
        });
      }
    }

    // Sort by priority, take top 3
    alerts.sort((a, b) => a.priority - b.priority);
    const topAlerts = alerts.slice(0, 3).map(({ type, message }) => ({ type, message }));

    // 10. Top 3 things to do (auto-generated)
    const todos: string[] = [];
    if (killCount > 0) todos.push(`Tắt ${killCount} camp lỗ → tiết kiệm $${killSavings.toFixed(0)}/ngày`);
    if (scaleCount > 0) todos.push(`Tăng budget ${scaleCount} camp tốt → thêm ~$${scaleExtraProfit.toFixed(0)}/ngày`);
    if (currentAvgCpa > targetCpa) todos.push(`CPA trung bình $${currentAvgCpa.toFixed(0)} > target $${targetCpa} — cần tối ưu`);

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
      scenarios,
      alerts: topAlerts,
      todos,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Brief generation failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
