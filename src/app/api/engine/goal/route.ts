import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateGoalBreakdown, type GoalConfig, type ActualMetrics, type CampaignForGoal } from '@/engine/goalEngine';
import { getAdAccountToday } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

/**
 * GET /api/engine/goal
 * Returns the goal breakdown for the current month.
 */
export async function GET() {
  try {
    // 1. Load business profile
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .limit(1)
      .single();

    if (!profile) {
      return NextResponse.json({
        success: false,
        error: 'Business profile not configured. Go to Settings first.',
      }, { status: 400 });
    }

    const goalConfig: GoalConfig = {
      monthlyProfitTarget: profile.monthly_profit_target ?? 15000,
      aov: profile.aov ?? 86,
      avgCogsRate: profile.avg_cogs_rate ?? 0.20,
      targetCpa: profile.target_cpa ?? 40,
      safetyBuffer: 1.10,
    };

    // 2. Calculate date ranges
    const today = getAdAccountToday();
    const dayOfMonth = new Date(today).getDate();
    const firstOfMonth = today.slice(0, 8) + '01';
    const daysInMonth = new Date(
      new Date(today).getFullYear(),
      new Date(today).getMonth() + 1,
      0
    ).getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    // 3. Get today's financial data
    const { data: todayFinancials } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_revenue')
      .eq('report_date', today)
      .single();

    const todayRevenue = todayFinancials?.shopify_revenue ?? 0;

    // 4. Get today's ad spend from campaign snapshots
    const { data: todaySnapshots } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend, conversions')
      .eq('snapshot_date', today)
      .gt('spend', 0);

    const todayAdSpend = todaySnapshots?.reduce((s: number, r: { spend: number }) => s + (r.spend || 0), 0) ?? 0;
    const todayOrders = todaySnapshots?.reduce((s: number, r: { conversions: number }) => s + (r.conversions || 0), 0) ?? 0;
    const todayCpa = todayOrders > 0 ? todayAdSpend / todayOrders : null;

    // 5. Get month-to-date financials
    const { data: mtdFinancials } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_revenue')
      .gte('report_date', firstOfMonth)
      .lte('report_date', today);

    const mtdRevenue = mtdFinancials?.reduce((s: number, r: { shopify_revenue: number }) => s + (r.shopify_revenue || 0), 0) ?? 0;

    // 6. Get month-to-date ad spend
    const { data: mtdSnapshots } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('spend, conversions')
      .gte('snapshot_date', firstOfMonth)
      .lte('snapshot_date', today)
      .gt('spend', 0);

    const mtdAdSpend = mtdSnapshots?.reduce((s: number, r: { spend: number }) => s + (r.spend || 0), 0) ?? 0;
    const mtdOrders = mtdSnapshots?.reduce((s: number, r: { conversions: number }) => s + (r.conversions || 0), 0) ?? 0;
    const mtdProfit = mtdRevenue * (1 - goalConfig.avgCogsRate) - mtdAdSpend;

    const actualMetrics: ActualMetrics = {
      todayRevenue,
      todayAdSpend,
      todayOrders,
      todayCpa,
      monthToDateProfit: Math.round(mtdProfit * 100) / 100,
      monthToDateRevenue: mtdRevenue,
      monthToDateAdSpend: mtdAdSpend,
      monthToDateOrders: mtdOrders,
      daysElapsed: dayOfMonth,
      daysRemaining,
    };

    // 7. Get campaign data for recommendations (today's spending campaigns)
    const { data: campaignData } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, campaign_name, spend, conversions, daily_budget, revenue_fb, fb_status')
      .eq('snapshot_date', today)
      .gt('spend', 0)
      .order('spend', { ascending: false })
      .limit(100);

    // Get classified statuses
    const { data: classifiedCampaigns } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, status')
      .eq('snapshot_date', today)
      .not('status', 'is', null);

    const statusMap = new Map<string, string>();
    classifiedCampaigns?.forEach((c: { campaign_id: string; status: string }) => {
      statusMap.set(c.campaign_id, c.status);
    });

    const campaigns: CampaignForGoal[] = (campaignData || []).map((c: {
      campaign_id: string;
      campaign_name: string;
      spend: number;
      conversions: number;
      daily_budget: number;
      revenue_fb: number | null;
      fb_status: string;
    }) => ({
      campaignId: c.campaign_id,
      campaignName: c.campaign_name,
      status: statusMap.get(c.campaign_id) || 'LEARNING',
      spend: c.spend || 0,
      conversions: c.conversions || 0,
      cpa: c.conversions > 0 ? c.spend / c.conversions : null,
      dailyBudget: c.daily_budget || 0,
      roas: c.spend > 0 && c.revenue_fb ? c.revenue_fb / c.spend : null,
    }));

    // 8. Calculate goal breakdown
    const breakdown = calculateGoalBreakdown(goalConfig, actualMetrics, campaigns);

    return NextResponse.json({
      success: true,
      goal: breakdown,
      date: today,
    });
  } catch {
    return NextResponse.json(
      { error: 'Goal calculation failed.' },
      { status: 500 }
    );
  }
}

