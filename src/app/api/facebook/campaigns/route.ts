import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday } from '@/lib/timezone';

/**
 * GET /api/facebook/campaigns
 * Returns campaign data from DB, aggregated over a timeframe.
 * Query params:
 *   ?days=3       — Aggregate over last N days (default: 3)
 *   ?status=WINNER — Filter by classification status
 *   ?date=YYYY-MM-DD — Override "today" anchor date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '3', 10);
    const status = searchParams.get('status');
    let anchorDate = searchParams.get('date') || getAdAccountToday();

    // Smart fallback: if no explicit date and today has no data, use latest date
    if (!searchParams.get('date')) {
      const { count } = await supabaseAdmin
        .from('campaign_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', anchorDate)
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
          anchorDate = latestSnap.snapshot_date;
        }
      }
    }

    // Calculate date range
    const fromDate = new Date(
      new Date(anchorDate).getTime() - (days - 1) * 86400000
    ).toISOString().split('T')[0];

    // Fetch raw snapshots in range
    // IMPORTANT: Avoid Supabase 1000-row limit for large accounts
    let query = supabaseAdmin
      .from('campaign_snapshots')
      .select('*')
      .gte('snapshot_date', fromDate)
      .lte('snapshot_date', anchorDate)
      .gt('spend', 0) // only fetch campaigns with spend
      .order('spend', { ascending: false })
      .limit(10000);

    const { data: rawSnapshots, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    if (!rawSnapshots || rawSnapshots.length === 0) {
      return NextResponse.json({
        success: true,
        days,
        fromDate,
        toDate: anchorDate,
        campaigns: [],
        count: 0,
      });
    }

    // Aggregate: group by campaign_id, SUM metrics
    const campMap = new Map<string, {
      campaign_id: string;
      campaign_name: string;
      fb_status: string;
      effective_status: string;
      status: string | null;         // classifier status
      daily_budget: number;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue_fb: number;
      reach: number;
      cpa: number | null;
      ctr: number;
      cpm: number;
      cpc: number;
      roas_fb: number | null;
      performance_score: number | null;
      ltv_adjusted_cpa: number | null;
      margin_contribution: number | null;
      snapshot_date: string;         // latest date
      campaign_created_time: string | null;
      days_with_data: number;
    }>();

    for (const snap of rawSnapshots) {
      const existing = campMap.get(snap.campaign_id);
      if (existing) {
        existing.spend += snap.spend || 0;
        existing.impressions += snap.impressions || 0;
        existing.clicks += snap.clicks || 0;
        existing.conversions += snap.conversions || 0;
        existing.revenue_fb += snap.revenue_fb || 0;
        existing.reach += snap.reach || 0;
        existing.days_with_data += 1;
        // Keep latest snapshot's metadata
        if (snap.snapshot_date > existing.snapshot_date) {
          existing.campaign_name = snap.campaign_name;
          existing.fb_status = snap.fb_status || 'ACTIVE';
          existing.effective_status = snap.effective_status || 'ACTIVE';
          existing.status = snap.status;
          existing.daily_budget = snap.daily_budget || 0;
          existing.performance_score = snap.performance_score;
          existing.ltv_adjusted_cpa = snap.ltv_adjusted_cpa;
          existing.margin_contribution = snap.margin_contribution;
          existing.snapshot_date = snap.snapshot_date;
        }
      } else {
        campMap.set(snap.campaign_id, {
          campaign_id: snap.campaign_id,
          campaign_name: snap.campaign_name,
          fb_status: snap.fb_status || 'ACTIVE',
          effective_status: snap.effective_status || 'ACTIVE',
          status: snap.status,
          daily_budget: snap.daily_budget || 0,
          spend: snap.spend || 0,
          impressions: snap.impressions || 0,
          clicks: snap.clicks || 0,
          conversions: snap.conversions || 0,
          revenue_fb: snap.revenue_fb || 0,
          reach: snap.reach || 0,
          cpa: null,
          ctr: 0,
          cpm: 0,
          cpc: 0,
          roas_fb: null,
          performance_score: snap.performance_score,
          ltv_adjusted_cpa: snap.ltv_adjusted_cpa,
          margin_contribution: snap.margin_contribution,
          snapshot_date: snap.snapshot_date,
          campaign_created_time: snap.campaign_created_time || null,
          days_with_data: 1,
        });
      }
    }

    // Recalculate derived metrics from aggregates
    const campaigns = Array.from(campMap.values()).map((c) => {
      c.cpa = c.conversions > 0 ? c.spend / c.conversions : null;
      c.ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
      c.cpm = c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0;
      c.cpc = c.clicks > 0 ? c.spend / c.clicks : 0;
      c.roas_fb = c.spend > 0 ? c.revenue_fb / c.spend : null;
      return c;
    });

    // Filter by classifier status if requested
    const filtered = status
      ? campaigns.filter((c) => c.status === status)
      : campaigns;

    // Sort by spend descending
    filtered.sort((a, b) => b.spend - a.spend);

    return NextResponse.json({
      success: true,
      days,
      fromDate,
      toDate: anchorDate,
      campaigns: filtered,
      count: filtered.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch campaigns: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
