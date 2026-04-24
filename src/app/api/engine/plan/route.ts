import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateActionPlanV2, type CampaignData, type PlannerConfig } from '@/engine/plannerV2';
import { calculateDailyMargin } from '@/engine/margin';
import { calculateGoalBreakdown, type GoalConfig, type ActualMetrics, type CampaignForGoal } from '@/engine/goalEngine';
import { getAdAccountToday } from '@/lib/timezone';
import { BIZ_DEFAULTS } from '@/lib/businessDefaults';

export const maxDuration = 300; // 5 minutes for Vercel Pro


/**
 * GET /api/engine/plan
 * Returns today's action plan. If none exists, generates one.
 * Query params: ?days=7&force=true
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7', 10);
    let date = searchParams.get('date') || getAdAccountToday();
    const force = searchParams.get('force') === 'true';

    // Smart fallback: if today has no data, use latest date with data
    if (!searchParams.get('date')) {
      const { count } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', date)
        .gt('spend', 0);

      if (!count || count === 0) {
        const { data: latestSnap } = await supabaseAdmin
          .from('campaign_snapshots')
          .select('snapshot_date')
          .gt('spend', 0)
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .single();
        if (latestSnap) {
          date = latestSnap.snapshot_date;
        }
      }
    }

    // Check if plan already exists (cache)
    if (!force) {
      const { data: existingPlan } = await supabaseAdmin
        .from('action_plans')
        .select('*')
        .eq('plan_date', date)
        .limit(1)
        .single();

      if (existingPlan) {
        return NextResponse.json({
          success: true,
          date,
          days,
          plan: existingPlan,
          cached: true,
        });
      }
    }

    return await generateAndReturnPlan(date, days);
  } catch (error) {
    return NextResponse.json(
      { error: 'Plan generation failed.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/engine/plan
 * Force re-generate today's action plan (with AI).
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7', 10);
    let today = getAdAccountToday();

    // Smart fallback: if today has no data, use latest date
    const { count } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('snapshot_date', today)
      .gt('spend', 0);

    if (!count || count === 0) {
      const { data: latestSnap } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('snapshot_date')
        .gt('spend', 0)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();
      if (latestSnap) {
        today = latestSnap.snapshot_date;
      }
    }

    return await generateAndReturnPlan(today, days);
  } catch (error) {
    return NextResponse.json(
      { error: 'Plan generation failed.' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────
// Helper: Per-day snapshot for a campaign
// ─────────────────────────────────────────

interface DailySnapshot {
  snapshot_date: string;
  spend: number;
  conversions: number;
  impressions: number;
  clicks: number;
  revenue_fb: number;
  ctr: number;
  cpm: number;
  cpc: number;
  frequency: number;
  add_to_cart: number;
  initiate_checkout: number;
}

// ─────────────────────────────────────────
// Main Plan Generation
// ─────────────────────────────────────────

async function generateAndReturnPlan(date: string, days: number) {
  // Use 7-day window for evaluation, but fetch up to `days` for trends
  const evalDays = Math.max(days, 7);
  const fromDate = new Date(
    new Date(date).getTime() - (evalDays - 1) * 86400000
  ).toISOString().split('T')[0];

  // 1. Get snapshots in range — ALL campaigns with any spend in period
  const { data: rawSnapshots } = await supabaseAdmin
    .from('campaign_snapshots')
    .select('*')
    .gte('snapshot_date', fromDate)
    .lte('snapshot_date', date)
    .gt('spend', 0)
    .order('snapshot_date', { ascending: true })
    .limit(10000);

  if (!rawSnapshots || rawSnapshots.length === 0) {
    return NextResponse.json({
      success: true,
      date,
      days,
      plan: null,
      message: 'Chưa có chiến dịch nào chi tiêu trong khoảng thời gian này. Hãy đồng bộ dữ liệu trước.',
    });
  }

  // 2. Group snapshots by campaign_id → daily arrays
  const campDailyMap = new Map<string, {
    name: string;
    fbStatus: string;
    dailyBudget: number;
    dailySnapshots: DailySnapshot[];
    createdTime: string | null;
  }>();

  for (const snap of rawSnapshots) {
    const existing = campDailyMap.get(snap.campaign_id);
    const dailySnap: DailySnapshot = {
      snapshot_date: snap.snapshot_date,
      spend: snap.spend || 0,
      conversions: snap.conversions || 0,
      impressions: snap.impressions || 0,
      clicks: snap.clicks || 0,
      revenue_fb: snap.revenue_fb || 0,
      ctr: snap.ctr || 0,
      cpm: snap.cpm || 0,
      cpc: snap.cpc || 0,
      frequency: snap.frequency || 0,
      add_to_cart: snap.add_to_cart || 0,
      initiate_checkout: snap.initiate_checkout || 0,
    };

    if (existing) {
      existing.dailySnapshots.push(dailySnap);
      // Keep latest metadata
      if (snap.snapshot_date >= existing.dailySnapshots[0].snapshot_date) {
        existing.fbStatus = snap.fb_status || 'ACTIVE';
        existing.dailyBudget = snap.daily_budget || 0;
      }
    } else {
      campDailyMap.set(snap.campaign_id, {
        name: snap.campaign_name,
        fbStatus: snap.fb_status || 'ACTIVE',
        dailyBudget: snap.daily_budget || 0,
        dailySnapshots: [dailySnap],
        createdTime: snap.campaign_created_time || null,
      });
    }
  }

  // 3. Get business profile
  const { data: profile } = await supabaseAdmin
    .from('business_profiles')
    .select('*')
    .limit(1)
    .single();

  const plannerConfig: PlannerConfig = {
    targetCpa: profile?.target_cpa ?? BIZ_DEFAULTS.TARGET_CPA,
    targetMarginMin: profile?.target_margin_min ?? BIZ_DEFAULTS.TARGET_MARGIN_MIN,
    targetMarginMax: profile?.target_margin_max ?? BIZ_DEFAULTS.TARGET_MARGIN_MAX,
    avgCogsRate: profile?.avg_cogs_rate ?? BIZ_DEFAULTS.COGS_RATE,
    aov: profile?.aov ?? BIZ_DEFAULTS.AOV,
    returningRate: profile?.returning_rate ?? 0.22,
    avgRepeatOrders: profile?.avg_repeat_orders ?? 1.5,
  };

  const breakevenCpa = plannerConfig.aov * (1 - plannerConfig.avgCogsRate);

  // 4. Build enriched CampaignData[] from daily snapshots
  const campaigns: CampaignData[] = [];

  for (const [campaignId, campInfo] of campDailyMap) {
    const snaps = campInfo.dailySnapshots;
    const sortedSnaps = [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

    // Today's snapshot (latest date)
    const todaySnap = sortedSnaps[sortedSnaps.length - 1];

    // 7-day aggregation
    const totalSpend7d = snaps.reduce((s, d) => s + d.spend, 0);
    const totalConv7d = snaps.reduce((s, d) => s + d.conversions, 0);
    const totalAtc7d = snaps.reduce((s, d) => s + d.add_to_cart, 0);
    const totalIc7d = snaps.reduce((s, d) => s + d.initiate_checkout, 0);
    const totalImpressions7d = snaps.reduce((s, d) => s + d.impressions, 0);
    const totalClicks7d = snaps.reduce((s, d) => s + d.clicks, 0);
    const totalRevenue7d = snaps.reduce((s, d) => s + d.revenue_fb, 0);

    const avgCPA7d = totalConv7d > 0 ? totalSpend7d / totalConv7d : null;
    const avgCTR7d = totalImpressions7d > 0 ? (totalClicks7d / totalImpressions7d) * 100 : 0;
    const avgFrequency7d = snaps.length > 0
      ? snaps.reduce((s, d) => s + d.frequency, 0) / snaps.length
      : 0;
    const avgAOV7d = totalConv7d > 0 ? totalRevenue7d / totalConv7d : null;
    const profitPerOrder7d = (avgAOV7d !== null && avgCPA7d !== null)
      ? avgAOV7d * (1 - plannerConfig.avgCogsRate) - avgCPA7d
      : null;

    // Trends: compare today vs 3 days ago
    let ctrTrend = 0;
    let cpaTrend = 0;
    let cpmTrend = 0;
    if (sortedSnaps.length >= 4) {
      const threeDaysAgo = sortedSnaps[sortedSnaps.length - 4];
      const current = todaySnap;
      ctrTrend = threeDaysAgo.ctr > 0
        ? ((current.ctr - threeDaysAgo.ctr) / threeDaysAgo.ctr) * 100
        : 0;
      cpmTrend = threeDaysAgo.cpm > 0
        ? ((current.cpm - threeDaysAgo.cpm) / threeDaysAgo.cpm) * 100
        : 0;
      // CPA trend from daily conversion data
      const todayCPA = current.conversions > 0 ? current.spend / current.conversions : null;
      const prevCPA = threeDaysAgo.conversions > 0 ? threeDaysAgo.spend / threeDaysAgo.conversions : null;
      cpaTrend = (todayCPA !== null && prevCPA !== null && prevCPA > 0)
        ? ((todayCPA - prevCPA) / prevCPA) * 100
        : 0;
    }

    // Stability: days with purchases
    const daysWithPurchases = snaps.filter(d => d.conversions > 0).length;

    // Consecutive profit days (from most recent)
    let consecutiveProfitDays = 0;
    for (let i = sortedSnaps.length - 1; i >= 0; i--) {
      const d = sortedSnaps[i];
      const dailyRevenue = d.revenue_fb;
      const dailyProfit = dailyRevenue * (1 - plannerConfig.avgCogsRate) - d.spend;
      if (dailyProfit > 0 && d.conversions > 0) {
        consecutiveProfitDays++;
      } else {
        break;
      }
    }

    // Today's CPA
    const todayCpa = todaySnap.conversions > 0 ? todaySnap.spend / todaySnap.conversions : null;

    // ROAS
    const totalRoas = totalSpend7d > 0 && totalRevenue7d > 0
      ? totalRevenue7d / totalSpend7d
      : null;

    campaigns.push({
      campaignId,
      campaignName: campInfo.name,
      fbStatus: campInfo.fbStatus,
      // Today
      spend: todaySnap.spend,
      conversions: todaySnap.conversions,
      cpa: todayCpa,
      ctr: todaySnap.ctr,
      cpm: todaySnap.cpm,
      cpc: todaySnap.cpc,
      roas_fb: totalRoas,
      dailyBudget: campInfo.dailyBudget,
      daysRunning: snaps.length,
      daysWithData: snaps.length,
      addToCart: todaySnap.add_to_cart,
      initiateCheckout: todaySnap.initiate_checkout,
      revenueFb: todaySnap.revenue_fb,
      impressions: todaySnap.impressions,
      clicks: todaySnap.clicks,
      frequency: todaySnap.frequency,
      // 7-day
      spend7d: totalSpend7d,
      conversions7d: totalConv7d,
      atc7d: totalAtc7d,
      ic7d: totalIc7d,
      avgCPA7d,
      avgCTR7d,
      avgFrequency7d,
      avgAOV7d,
      profitPerOrder7d,
      // Trends
      ctrTrend,
      cpaTrend,
      cpmTrend,
      // Stability
      daysWithPurchases,
      consecutiveProfitDays,
    });
  }

  // 5. Get TODAY's numbers — same source as Dashboard
  // Dashboard uses: /api/facebook/campaigns?days=1 → snapshot_date = today, spend > 0
  // Dashboard uses: /api/engine/margin?days=1 → daily_financials report_date = today
  const { data: todaySnapshots } = await supabaseAdmin
    .from('campaign_snapshots')
    .select('spend, conversions')
    .eq('snapshot_date', date)
    .gt('spend', 0);

  const todaySpend = todaySnapshots?.reduce((s: number, r: { spend: number }) => s + (r.spend || 0), 0) ?? 0;
  const todayOrders = todaySnapshots?.reduce((s: number, r: { conversions: number }) => s + (r.conversions || 0), 0) ?? 0;

  const { data: todayFinancialRow } = await supabaseAdmin
    .from('daily_financials')
    .select('shopify_revenue')
    .eq('report_date', date)
    .limit(1)
    .single();

  const todayRevenue = todayFinancialRow?.shopify_revenue ?? 0;

  const marginResult = calculateDailyMargin(todayRevenue, todaySpend, {
    targetMarginMin: plannerConfig.targetMarginMin,
    targetMarginMax: plannerConfig.targetMarginMax,
    avgCogsRate: plannerConfig.avgCogsRate,
  });

  // 6. AI config (if key exists)
  const aiConfig = profile?.ai_api_key
    ? {
        provider: profile.ai_provider || 'openai',
        apiKey: profile.ai_api_key,
        model: profile.ai_model || 'gpt-4o-mini',
      }
    : undefined;

  // 7. Generate plan
  const plan = await generateActionPlanV2(campaigns, plannerConfig, marginResult, days, aiConfig);

  // 8. Save to DB (best effort)
  try {
    await supabaseAdmin.from('action_plans').upsert(
      {
        plan_date: date,
        actions: plan.actions,
        projected_margin: plan.projectedMargin,
        budget_saved: plan.budgetSaved,
        ai_summary: plan.aiSummary,
        ai_used: plan.aiUsed,
        ai_tokens: plan.aiTokens,
      },
      { onConflict: 'plan_date' }
    );
  } catch {
    // Non-critical: plan was generated successfully even if DB save fails
  }

  // ── Goal Breakdown (parallel to plan generation) ──
  let goalBreakdown = null;
  try {
    const goalConfig: GoalConfig = {
      monthlyProfitTarget: profile?.monthly_profit_target ?? 15000,
      aov: plannerConfig.aov,
      avgCogsRate: plannerConfig.avgCogsRate,
      targetCpa: plannerConfig.targetCpa,
      safetyBuffer: 1.10,
    };

    const dayOfMonth = new Date(date).getDate();
    const daysInMonth = new Date(
      new Date(date).getFullYear(),
      new Date(date).getMonth() + 1,
      0
    ).getDate();

    // Get MTD data for goal tracking
    const firstOfMonth = date.slice(0, 8) + '01';
    const { data: mtdFinancials } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_revenue')
      .gte('report_date', firstOfMonth)
      .lte('report_date', date);

    const mtdRevenue = mtdFinancials?.reduce((s: number, r: { shopify_revenue: number }) => s + (r.shopify_revenue || 0), 0) ?? 0;

    const { data: mtdSnaps } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend, conversions')
      .gte('snapshot_date', firstOfMonth)
      .lte('snapshot_date', date)
      .gt('spend', 0);

    const mtdAdSpend = mtdSnaps?.reduce((s: number, r: { spend: number }) => s + (r.spend || 0), 0) ?? 0;
    const mtdOrders = mtdSnaps?.reduce((s: number, r: { conversions: number }) => s + (r.conversions || 0), 0) ?? 0;

    const actualMetrics: ActualMetrics = {
      todayRevenue: todayRevenue,
      todayAdSpend: todaySpend,
      todayOrders: todayOrders,
      todayCpa: todayOrders > 0 ? todaySpend / todayOrders : null,
      monthToDateProfit: mtdRevenue * (1 - goalConfig.avgCogsRate) - mtdAdSpend,
      monthToDateRevenue: mtdRevenue,
      monthToDateAdSpend: mtdAdSpend,
      monthToDateOrders: mtdOrders,
      daysElapsed: dayOfMonth,
      daysRemaining: daysInMonth - dayOfMonth,
    };

    const goalCampaigns: CampaignForGoal[] = campaigns.map(c => {
      const evalResult = plan.evaluations.find(e => e.campaignId === c.campaignId);
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        status: evalResult?.lifecycle || 'LEARNING',
        spend: c.spend7d,
        conversions: c.conversions7d,
        cpa: c.avgCPA7d,
        dailyBudget: c.dailyBudget,
        roas: c.roas_fb,
      };
    });

    goalBreakdown = calculateGoalBreakdown(goalConfig, actualMetrics, goalCampaigns);
  } catch (goalErr) {
    console.error('Goal breakdown failed (non-critical):', goalErr);
  }

  return NextResponse.json({
    success: true,
    date,
    days,
    plan,
    goal: goalBreakdown,
    margin: marginResult,
    cached: false,
  });
}
