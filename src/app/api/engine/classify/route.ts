import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { classifyAllCampaigns, type CampaignInput } from '@/engine/classifier';
import { calculateDailyMargin } from '@/engine/margin';
import { getAdAccountToday, getAdAccountDateMinusDays } from '@/lib/timezone';
import { BIZ_DEFAULTS } from '@/lib/businessDefaults';

/**
 * POST /api/engine/classify
 * Runs the campaign classifier on all campaigns for today.
 * Updates campaign_snapshots with computed status + scores.
 */
export async function POST() {
  try {
    const today = getAdAccountToday();
    const sevenDaysAgo = getAdAccountDateMinusDays(7);

    // 1. Get today's campaign snapshots
    const { data: todaySnapshots, error: snapError } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('*')
      .eq('snapshot_date', today);

    if (snapError || !todaySnapshots) {
      return NextResponse.json({ error: 'No campaign data for today.' }, { status: 400 });
    }

    // 2. Get historical CPA data for stability scoring
    const { data: historicalSnapshots } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('campaign_id, snapshot_date, cpa')
      .gte('snapshot_date', sevenDaysAgo)
      .lte('snapshot_date', today)
      .not('cpa', 'is', null);

    // Build CPA history maps
    const cpaHistoryMap = new Map<string, number[]>();
    if (historicalSnapshots) {
      for (const s of historicalSnapshots) {
        const existing = cpaHistoryMap.get(s.campaign_id) || [];
        if (s.cpa != null) existing.push(s.cpa);
        cpaHistoryMap.set(s.campaign_id, existing);
      }
    }

    // 3. Get scaling history for budget-change detection
    const { data: scalingEvents } = await supabaseAdmin
      .from('scaling_history')
      .select('campaign_id, created_at')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    const recentlyScaledCampaigns = new Set(
      scalingEvents?.map((e: { campaign_id: string }) => e.campaign_id) || []
    );

    // 4. Get margin data
    const { data: financial } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_revenue')
      .eq('report_date', today)
      .limit(1)
      .single();

    const totalAdSpend = todaySnapshots.reduce(
      (sum: number, s: { spend: number }) => sum + (s.spend || 0), 0
    );
    const shopifyRevenue = financial?.shopify_revenue || 0;

    // 5. Get business profile config
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .limit(1)
      .single();

    const marginResult = calculateDailyMargin(shopifyRevenue, totalAdSpend, {
      targetMarginMin: profile?.target_margin_min ?? BIZ_DEFAULTS.TARGET_MARGIN_MIN,
      targetMarginMax: profile?.target_margin_max ?? BIZ_DEFAULTS.TARGET_MARGIN_MAX,
      avgCogsRate: profile?.avg_cogs_rate ?? BIZ_DEFAULTS.COGS_RATE,
    });

    // 6. Build classifier inputs
    const campaignInputs: CampaignInput[] = todaySnapshots.map((s: Record<string, unknown>) => {
      const firstSnapshot = historicalSnapshots?.find(
        (h: Record<string, unknown>) => h.campaign_id === s.campaign_id
      );
      const firstDate = firstSnapshot
        ? new Date(firstSnapshot.snapshot_date as string)
        : new Date(today);
      const daysRunning = Math.max(1, Math.floor(
        (new Date(today).getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      ));

      return {
        campaignId: s.campaign_id as string,
        campaignName: s.campaign_name as string,
        spend: (s.spend as number) || 0,
        conversions: (s.conversions as number) || 0,
        cpa: s.cpa as number | null,
        ctr: (s.ctr as number) || 0,
        dailyCpaHistory: cpaHistoryMap.get(s.campaign_id as string) || [],
        daysRunning,
        budgetChangedWithin24h: recentlyScaledCampaigns.has(s.campaign_id as string),
      };
    });

    // 7. Run classifier
    const results = classifyAllCampaigns(campaignInputs, marginResult.dailyMargin, {
      returningRate: profile?.returning_rate ?? 0.22,
      avgRepeatOrders: profile?.avg_repeat_orders ?? 1.5,
      aov: profile?.aov ?? BIZ_DEFAULTS.AOV,
      targetMarginMin: profile?.target_margin_min ?? BIZ_DEFAULTS.TARGET_MARGIN_MIN,
      targetMarginMax: profile?.target_margin_max ?? BIZ_DEFAULTS.TARGET_MARGIN_MAX,
      avgCogsRate: profile?.avg_cogs_rate ?? BIZ_DEFAULTS.COGS_RATE,
      thresholdWinner: profile?.threshold_winner ?? 0.7,
      thresholdPromising: profile?.threshold_promising ?? 0.4,
      thresholdWatch: profile?.threshold_watch ?? 0.2,
      targetCpa: profile?.target_cpa ?? BIZ_DEFAULTS.TARGET_CPA,
      benchmarkCtr: 2.0,
    });

    // 8. Update snapshots with classification results
    let updatedCount = 0;
    for (const result of results) {
      const { error } = await supabaseAdmin
        .from('campaign_snapshots')
        .update({
          status: result.status,
          performance_score: result.performanceScore,
          ltv_adjusted_cpa: result.ltvAdjustedCpa,
          margin_contribution: result.marginContribution,
        })
        .eq('campaign_id', result.campaignId)
        .eq('snapshot_date', today);

      if (!error) updatedCount++;
    }

    // Summary by status
    const statusCounts = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      success: true,
      date: today,
      classified: results.length,
      updated: updatedCount,
      statusCounts,
      dailyMargin: marginResult.marginPercent,
      marginStatus: marginResult.marginStatus,
    });
  } catch {
    return NextResponse.json(
      { error: 'Classification failed.' },
      { status: 500 }
    );
  }
}

