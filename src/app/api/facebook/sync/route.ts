import { NextRequest, NextResponse } from 'next/server';
import {
  fetchCampaigns,
  fetchCampaignInsights,
  extractPurchaseCount,
  extractPurchaseCPA,
  extractPurchaseRevenue,
  parseFBBudget,
  calculateFBRoas,
} from '@/lib/facebook';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdAccountToday, getAdAccountDateMinusDays } from '@/lib/timezone';

export const maxDuration = 300; // 5 minutes for Vercel Pro

/**
 * POST /api/facebook/sync
 * Triggers a manual sync of Facebook campaign data.
 * Uses ad-account timezone (GMT-7) for date alignment.
 * Now surfaces per-account errors to frontend.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Fetch config directly from database to get ALL accounts
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('fb_accounts, fb_access_token, fb_ad_account_id')
      .limit(1)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Business profile not found.' }, { status: 400 });
    }

    let accountsToSync: { accessToken: string; adAccountId: string; apiVersion: string }[] = [];

    // Prioritize new JSONB array
    if (profile.fb_accounts && Array.isArray(profile.fb_accounts) && profile.fb_accounts.length > 0) {
      accountsToSync = profile.fb_accounts
        .filter((a: any) => (a.accessToken || a.access_token) && (a.accountId || a.adAccountId))
        .map((a: any) => ({
          accessToken: a.accessToken || a.access_token,
          adAccountId: a.accountId || a.adAccountId,
          apiVersion: 'v21.0'
        }));
    } else if (profile.fb_access_token && profile.fb_ad_account_id) {
      // Fallback to legacy single config
      accountsToSync = [{
        accessToken: profile.fb_access_token,
        adAccountId: profile.fb_ad_account_id,
        apiVersion: 'v21.0'
      }];
    }

    // Check if body overrides (for explicit single-account manual sync/test)
    try {
      const body = await request.json();
      if (body.accessToken && body.adAccountId) {
        accountsToSync = [{
          accessToken: body.accessToken,
          adAccountId: body.adAccountId,
          apiVersion: 'v21.0',
        }];
      }
    } catch {
      // Ignored — POST without body is fine
    }

    if (accountsToSync.length === 0) {
      return NextResponse.json(
        { error: 'Facebook not configured. Set access token and ad account ID in Settings.' },
        { status: 400 }
      );
    }

    // ── Use ad-account timezone for date range ──
    const today = getAdAccountToday();
    const sevenDaysAgo = getAdAccountDateMinusDays(7);

    // ── Fetch campaigns + insights per account, track errors ──
    const allCampaigns: any[] = [];
    const allInsights: any[] = [];
    const accountErrors: { accountId: string; error: string }[] = [];
    let accountsSucceeded = 0;

    for (const config of accountsToSync) {
      try {
        const campaigns = await fetchCampaigns(config);
        allCampaigns.push(...campaigns);

        const insights = await fetchCampaignInsights(sevenDaysAgo, today, config);
        allInsights.push(...insights);
        accountsSucceeded++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SYNC FAIL] Account ${config.adAccountId}: ${errMsg}`);
        accountErrors.push({
          accountId: config.adAccountId,
          error: errMsg,
        });
      }
    }

    // ── If ALL accounts failed, return error ──
    if (accountsSucceeded === 0 && accountErrors.length > 0) {
      const durationMs = Date.now() - startTime;
      const errorSummary = accountErrors
        .map((e) => `${e.accountId}: ${e.error}`)
        .join(' | ');

      try {
        await supabaseAdmin.from('sync_logs').insert({
          sync_type: 'FACEBOOK',
          status: 'FAILED',
          error_message: errorSummary,
          duration_ms: durationMs,
        });
      } catch {
        // Ignore logging errors
      }

      return NextResponse.json({
        success: false,
        error: 'All Facebook accounts failed to sync.',
        accountErrors,
        durationMs,
      }, { status: 502 });
    }

    // ── Upsert snapshots into DB ──
    let syncedCount = 0;
    const snapshotsToUpsert: any[] = [];

    for (const campaign of allCampaigns) {
      const insightsForCampaign = allInsights.filter(i => i.campaign_id === campaign.id);
      const dailyBudget = parseFBBudget(campaign.daily_budget);

      if (insightsForCampaign.length === 0) {
        // No insights — save a zero-spend snapshot for today
        snapshotsToUpsert.push({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          snapshot_date: today,
          snapshot_hour: 0,
          daily_budget: dailyBudget,
          spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue_fb: 0,
          cpa: null, ctr: 0, cpm: 0, cpc: 0, roas_fb: null, reach: 0, frequency: 0,
          fb_status: campaign.status || 'ACTIVE',
          effective_status: campaign.status || 'ACTIVE',
          campaign_created_time: campaign.created_time || null,
        });
        continue;
      }

      for (const insight of insightsForCampaign) {
        const conversions = extractPurchaseCount(insight.actions);
        const cpa = extractPurchaseCPA(insight.cost_per_action_type);
        const revenueFb = extractPurchaseRevenue(insight.action_values);
        const roas = calculateFBRoas(insight);

        snapshotsToUpsert.push({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          snapshot_date: insight.date_start,
          snapshot_hour: 0,
          daily_budget: dailyBudget,
          spend: parseFloat(insight.spend),
          impressions: parseInt(insight.impressions, 10),
          clicks: parseInt(insight.clicks, 10),
          conversions,
          revenue_fb: revenueFb,
          cpa,
          ctr: parseFloat(insight.ctr),
          cpm: parseFloat(insight.cpm),
          cpc: insight.cpc ? parseFloat(insight.cpc) : 0,
          roas_fb: roas,
          reach: parseInt(insight.reach, 10),
          frequency: insight.frequency ? parseFloat(insight.frequency) : 0,
          fb_status: campaign.status || 'ACTIVE',
          effective_status: campaign.status || 'ACTIVE',
          campaign_created_time: campaign.created_time || null,
        });
      }
    }

    // Process chunk upserts
    const CHUNK_SIZE = 500;
    for (let i = 0; i < snapshotsToUpsert.length; i += CHUNK_SIZE) {
      const chunk = snapshotsToUpsert.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from('campaign_snapshots')
        .upsert(chunk, { onConflict: 'campaign_id,snapshot_date,snapshot_hour' });
      
      if (error) {
        console.error(`Error batch upserting snapshots ${i} to ${i + CHUNK_SIZE}:`, error);
      } else {
        syncedCount += chunk.length;
      }
    }

    // ── Log sync result ──
    const durationMs = Date.now() - startTime;
    const hasPartialErrors = accountErrors.length > 0;

    await supabaseAdmin.from('sync_logs').insert({
      sync_type: 'FACEBOOK',
      status: hasPartialErrors ? 'PARTIAL' : 'SUCCESS',
      campaigns_synced: syncedCount,
      duration_ms: durationMs,
      error_message: hasPartialErrors
        ? accountErrors.map((e) => `${e.accountId}: ${e.error}`).join(' | ')
        : null,
    });

    return NextResponse.json({
      success: true,
      adAccountTimezone: 'GMT-7',
      dateRange: { from: sevenDaysAgo, to: today },
      campaignsSynced: syncedCount,
      totalCampaigns: allCampaigns.length,
      insightsProcessed: allInsights.length,
      accountsSucceeded,
      accountErrors: hasPartialErrors ? accountErrors : undefined,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;

    try {
      await supabaseAdmin.from('sync_logs').insert({
        sync_type: 'FACEBOOK',
        status: 'FAILED',
        error_message: String(error),
        duration_ms: durationMs,
      });
    } catch {
      // Ignore logging errors
    }

    return NextResponse.json(
      { error: `Facebook sync failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
