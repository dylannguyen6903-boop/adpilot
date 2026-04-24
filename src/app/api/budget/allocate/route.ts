import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { allocateBudget, type AllocatorCampaignInput } from '@/engine/allocator';
import type { CampaignStatus } from '@/types/campaign';
import { getAdAccountToday } from '@/lib/timezone';
import { BIZ_DEFAULTS } from '@/lib/businessDefaults';

/**
 * POST /api/budget/allocate
 * Calculate optimal budget allocation across campaigns.
 * Body: { totalDailyBudget: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const totalDailyBudget = body.totalDailyBudget || 180;
    const adAccountId = body.ad_account_id;
    const today = getAdAccountToday();

    // Get campaign data
    let query = supabaseAdmin
      .from('campaign_snapshots')
      .select('*')
      .eq('snapshot_date', today);
      
    if (adAccountId) {
      query = query.eq('ad_account_id', adAccountId);
    }
    
    const { data: snapshots } = await query;

    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json({ error: 'No campaign data for today.' }, { status: 400 });
    }

    // Get profile
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .limit(1)
      .single();

    // Get revenue
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

    const result = allocateBudget(campaigns, {
      totalDailyBudget,
      marginConfig: {
        targetMarginMin: profile?.target_margin_min ?? BIZ_DEFAULTS.TARGET_MARGIN_MIN,
        targetMarginMax: profile?.target_margin_max ?? BIZ_DEFAULTS.TARGET_MARGIN_MAX,
        avgCogsRate: profile?.avg_cogs_rate ?? BIZ_DEFAULTS.COGS_RATE,
      },
      currentRevenue: financial?.shopify_revenue || 0,
      currentTotalSpend: totalSpend,
      aov: profile?.aov ?? BIZ_DEFAULTS.AOV,
    });

    return NextResponse.json({ success: true, allocation: result });
  } catch {
    return NextResponse.json(
      { error: 'Budget allocation failed.' },
      { status: 500 }
    );
  }
}

