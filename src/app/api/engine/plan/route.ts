import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateActionPlanV2, type CampaignData, type PlannerConfig } from '@/engine/plannerV2';
import { calculateDailyMargin } from '@/engine/margin';
import { getAdAccountToday } from '@/lib/timezone';

/**
 * GET /api/engine/plan
 * Returns today's action plan. If none exists, generates one.
 * Query params: ?days=3&force=true
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '3', 10);
    const date = searchParams.get('date') || getAdAccountToday();
    const force = searchParams.get('force') === 'true';

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
      { error: `Plan generation failed: ${error instanceof Error ? error.message : String(error)}` },
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
    const days = parseInt(searchParams.get('days') || '3', 10);
    const today = getAdAccountToday();
    return await generateAndReturnPlan(today, days);
  } catch (error) {
    return NextResponse.json(
      { error: `Plan generation failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

async function generateAndReturnPlan(date: string, days: number) {
  const fromDate = new Date(
    new Date(date).getTime() - (days - 1) * 86400000
  ).toISOString().split('T')[0];

  // 1. Get snapshots in range
  const { data: rawSnapshots } = await supabaseAdmin
    .from('campaign_snapshots')
    .select('*')
    .gte('snapshot_date', fromDate)
    .lte('snapshot_date', date);

  if (!rawSnapshots || rawSnapshots.length === 0) {
    return NextResponse.json({
      success: true,
      date,
      days,
      plan: null,
      message: 'No campaign data for this period. Sync data first.',
    });
  }

  // 2. Aggregate snapshots by campaign_id
  const campMap = new Map<string, CampaignData & { _totalImpressions: number; _totalClicks: number }>();
  const dateSet = new Map<string, Set<string>>();

  for (const snap of rawSnapshots) {
    const existing = campMap.get(snap.campaign_id);
    if (existing) {
      existing.spend += snap.spend || 0;
      existing.conversions += snap.conversions || 0;
      existing._totalImpressions += snap.impressions || 0;
      existing._totalClicks += snap.clicks || 0;
      if (snap.revenue_fb) existing.roas_fb = (existing.roas_fb || 0) + snap.revenue_fb;
      dateSet.get(snap.campaign_id)!.add(snap.snapshot_date);
      // Keep latest metadata
      if (snap.snapshot_date > existing.campaignName) {
        existing.fbStatus = snap.fb_status || 'ACTIVE';
        existing.dailyBudget = snap.daily_budget || 0;
      }
    } else {
      campMap.set(snap.campaign_id, {
        campaignId: snap.campaign_id,
        campaignName: snap.campaign_name,
        fbStatus: snap.fb_status || 'ACTIVE',
        spend: snap.spend || 0,
        conversions: snap.conversions || 0,
        cpa: null,
        ctr: 0,
        cpm: 0,
        roas_fb: snap.revenue_fb || 0,
        dailyBudget: snap.daily_budget || 0,
        daysRunning: 1,
        daysWithData: 1,
        _totalImpressions: snap.impressions || 0,
        _totalClicks: snap.clicks || 0,
      });
      dateSet.set(snap.campaign_id, new Set([snap.snapshot_date]));
    }
  }

  // Compute derived metrics
  const campaigns: CampaignData[] = Array.from(campMap.values()).map((c) => {
    c.cpa = c.conversions > 0 ? c.spend / c.conversions : null;
    c.ctr = c._totalImpressions > 0 ? (c._totalClicks / c._totalImpressions) * 100 : 0;
    c.cpm = c._totalImpressions > 0 ? (c.spend / c._totalImpressions) * 1000 : 0;
    c.roas_fb = c.spend > 0 && c.roas_fb ? c.roas_fb / c.spend : null;
    c.daysWithData = dateSet.get(c.campaignId)?.size || 1;
    c.daysRunning = c.daysWithData; // Simplified — could use campaign_created_time if available
    return c as CampaignData;
  });

  // 3. Get business profile
  const { data: profile } = await supabaseAdmin
    .from('business_profiles')
    .select('*')
    .limit(1)
    .single();

  const plannerConfig: PlannerConfig = {
    targetCpa: profile?.target_cpa ?? 40,
    targetMarginMin: profile?.target_margin_min ?? 0.17,
    targetMarginMax: profile?.target_margin_max ?? 0.20,
    avgCogsRate: profile?.avg_cogs_rate ?? 0.80,
    aov: profile?.aov ?? 87,
    returningRate: profile?.returning_rate ?? 0.22,
    avgRepeatOrders: profile?.avg_repeat_orders ?? 1.5,
  };

  // 4. Get Shopify revenue for margin
  const { data: financials } = await supabaseAdmin
    .from('daily_financials')
    .select('shopify_revenue')
    .gte('report_date', fromDate)
    .lte('report_date', date);

  const shopifyRevenue = financials
    ? financials.reduce((sum: number, f: { shopify_revenue: number }) => sum + (f.shopify_revenue || 0), 0)
    : 0;

  const totalAdSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const marginResult = calculateDailyMargin(shopifyRevenue, totalAdSpend, {
    targetMarginMin: plannerConfig.targetMarginMin,
    targetMarginMax: plannerConfig.targetMarginMax,
    avgCogsRate: plannerConfig.avgCogsRate,
  });

  // 5. AI config (if key exists)
  const aiConfig = profile?.ai_api_key
    ? {
        provider: profile.ai_provider || 'openai',
        apiKey: profile.ai_api_key,
        model: profile.ai_model || 'gpt-4o-mini',
      }
    : undefined;

  // 6. Generate plan
  const plan = await generateActionPlanV2(campaigns, plannerConfig, marginResult, days, aiConfig);

  // 7. Save to DB (best effort)
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

  return NextResponse.json({
    success: true,
    date,
    days,
    plan,
    cached: false,
  });
}
