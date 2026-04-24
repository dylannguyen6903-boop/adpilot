import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { allocateBudget, type AllocatorCampaignInput } from '@/engine/allocator';
import type { CampaignStatus } from '@/types/campaign';
import { getAdAccountToday } from '@/lib/timezone';
import { BIZ_DEFAULTS } from '@/lib/businessDefaults';

/**
 * POST /api/budget/simulate
 * What-if simulator: test how different total budgets affect allocation.
 * Body: { totalDailyBudget: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const budgets: number[] = body.budgets || [150, 180, 200, 250];
    const today = getAdAccountToday();

    const { data: snapshots } = await supabaseAdmin
      .from('campaign_snapshots')
      .select('*')
      .eq('snapshot_date', today);

    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json({ error: 'No campaign data for today.' }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .limit(1)
      .single();

    const { data: financial } = await supabaseAdmin
      .from('daily_financials')
      .select('shopify_revenue')
      .eq('report_date', today)
      .limit(1)
      .single();

    const campaigns: AllocatorCampaignInput[] = snapshots.map((s: Record<string, unknown>) => ({
      campaignId: s.campaign_id as string,
      campaignName: s.campaign_name as string,
      status: ((s.status as string) || 'WATCH') as CampaignStatus,
      currentBudget: (s.daily_budget as number) || 0,
      performanceScore: (s.performance_score as number) || 0,
      conversions: (s.conversions as number) || 0,
      cpa: s.cpa as number | null,
      spend: (s.spend as number) || 0,
    }));

    const totalSpend = snapshots.reduce(
      (sum: number, s: { spend: number }) => sum + (s.spend || 0), 0
    );

    const simulations = budgets.map((budget) =>
      allocateBudget(campaigns, {
        totalDailyBudget: budget,
        marginConfig: {
          targetMarginMin: profile?.target_margin_min ?? BIZ_DEFAULTS.TARGET_MARGIN_MIN,
          targetMarginMax: profile?.target_margin_max ?? BIZ_DEFAULTS.TARGET_MARGIN_MAX,
          avgCogsRate: profile?.avg_cogs_rate ?? BIZ_DEFAULTS.COGS_RATE,
        },
        currentRevenue: financial?.shopify_revenue || 0,
        currentTotalSpend: totalSpend,
        aov: profile?.aov ?? BIZ_DEFAULTS.AOV,
      })
    );

    return NextResponse.json({ success: true, simulations });
  } catch (error) {
    return NextResponse.json(
      { error: `Simulation failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
