/**
 * Facebook Marketing API Client for AdPilot
 * 
 * Handles all interactions with Facebook Marketing API v21.0
 * - Fetch campaigns list
 * - Fetch campaign insights (metrics)
 * - Batch requests to respect rate limits
 */

const FB_API_BASE = 'https://graph.facebook.com';

interface FacebookConfig {
  accessToken: string;
  adAccountId: string;
  apiVersion: string;
}

/** Get Facebook config from environment or provided values */
export function getFacebookConfig(overrides?: Partial<FacebookConfig>): FacebookConfig {
  return {
    accessToken: overrides?.accessToken || process.env.FB_ACCESS_TOKEN || '',
    adAccountId: overrides?.adAccountId || process.env.FB_AD_ACCOUNT_ID || '',
    apiVersion: overrides?.apiVersion || process.env.FB_API_VERSION || 'v21.0',
  };
}

/** Check if Facebook is configured */
export function isFacebookConfigured(config?: FacebookConfig): boolean {
  const cfg = config || getFacebookConfig();
  return !!(cfg.accessToken && cfg.adAccountId);
}

// ─────────────────────────────────────────────
// Types for Facebook API responses
// ─────────────────────────────────────────────

export interface FBCampaign {
  id: string;
  name: string;
  objective: string;
  status: string;              // ACTIVE, PAUSED, DELETED, ARCHIVED
  daily_budget?: string;       // in cents
  lifetime_budget?: string;
  created_time: string;
  updated_time: string;
}

export interface FBInsightAction {
  action_type: string;
  value: string;
}

export interface FBCostPerAction {
  action_type: string;
  value: string;
}

export interface FBInsight {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpm: string;
  cpc: string;
  reach: string;
  frequency: string;
  actions?: FBInsightAction[];
  cost_per_action_type?: FBCostPerAction[];
  action_values?: FBInsightAction[];   // revenue values
}

export interface FBPagingCursor {
  before: string;
  after: string;
}

export interface FBPaging {
  cursors?: FBPagingCursor;
  next?: string;
}

export interface FBResponse<T> {
  data: T[];
  paging?: FBPaging;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
  };
}

// ─────────────────────────────────────────────
// API Methods
// ─────────────────────────────────────────────

/** Make a request to Facebook Graph API */
async function fbRequest<T>(
  endpoint: string,
  config: FacebookConfig,
  params: Record<string, string> = {}
): Promise<FBResponse<T>> {
  const url = new URL(`${FB_API_BASE}/${config.apiVersion}/${endpoint}`);
  url.searchParams.set('access_token', config.accessToken);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    // Cache for 5 minutes to reduce API calls
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      `Facebook API error (${response.status}): ${
        errorBody?.error?.message || response.statusText
      }`
    );
  }

  return response.json();
}

/**
 * Fetch all active/paused campaigns from the ad account.
 */
export async function fetchCampaigns(
  config?: FacebookConfig
): Promise<FBCampaign[]> {
  const cfg = config || getFacebookConfig();
  if (!isFacebookConfigured(cfg)) {
    throw new Error('Facebook not configured. Set FB_ACCESS_TOKEN and FB_AD_ACCOUNT_ID.');
  }

  const allCampaigns: FBCampaign[] = [];
  let nextUrl: string | undefined;

  // First request
  const fields = 'id,name,objective,status,daily_budget,lifetime_budget,created_time,updated_time';
  const filtering = JSON.stringify([
    { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
  ]);

  const result = await fbRequest<FBCampaign>(
    `act_${cfg.adAccountId.replace('act_', '')}/campaigns`,
    cfg,
    { fields, filtering, limit: '100' }
  );

  if (result.error) {
    throw new Error(`Facebook API: ${result.error.message}`);
  }

  allCampaigns.push(...result.data);
  nextUrl = result.paging?.next;

  // Paginate if needed
  while (nextUrl) {
    const pageRes = await fetch(nextUrl);
    const pageData: FBResponse<FBCampaign> = await pageRes.json();
    allCampaigns.push(...pageData.data);
    nextUrl = pageData.paging?.next;
  }

  return allCampaigns;
}

/**
 * Fetch campaign insights (metrics) for a date range.
 * Returns daily breakdown by campaign.
 */
export async function fetchCampaignInsights(
  dateFrom: string,    // YYYY-MM-DD
  dateTo: string,      // YYYY-MM-DD
  config?: FacebookConfig
): Promise<FBInsight[]> {
  const cfg = config || getFacebookConfig();
  if (!isFacebookConfigured(cfg)) {
    throw new Error('Facebook not configured.');
  }

  const allInsights: FBInsight[] = [];
  let nextUrl: string | undefined;

  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'ctr',
    'cpm',
    'cpc',
    'reach',
    'frequency',
    'actions',
    'cost_per_action_type',
    'action_values',
  ].join(',');

  const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });

  const result = await fbRequest<FBInsight>(
    `act_${cfg.adAccountId.replace('act_', '')}/insights`,
    cfg,
    {
      fields,
      time_range: timeRange,
      time_increment: '1',       // Daily breakdown
      level: 'campaign',
      limit: '500',
    }
  );

  if (result.error) {
    throw new Error(`Facebook API: ${result.error.message}`);
  }

  allInsights.push(...result.data);
  nextUrl = result.paging?.next;

  while (nextUrl) {
    const pageRes = await fetch(nextUrl);
    const pageData: FBResponse<FBInsight> = await pageRes.json();
    allInsights.push(...pageData.data);
    nextUrl = pageData.paging?.next;
  }

  return allInsights;
}

// ─────────────────────────────────────────────
// Data Parsing Helpers
// ─────────────────────────────────────────────

/** Extract purchase count from FB actions array */
export function extractPurchaseCount(actions?: FBInsightAction[]): number {
  if (!actions) return 0;
  const purchase = actions.find(
    (a) =>
      a.action_type === 'purchase' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase'
  );
  return purchase ? parseInt(purchase.value, 10) : 0;
}

/** Extract CPA for purchases from cost_per_action_type */
export function extractPurchaseCPA(costPerAction?: FBCostPerAction[]): number | null {
  if (!costPerAction) return null;
  const purchaseCost = costPerAction.find(
    (a) =>
      a.action_type === 'purchase' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase'
  );
  return purchaseCost ? parseFloat(purchaseCost.value) : null;
}

/** Extract purchase revenue from action_values */
export function extractPurchaseRevenue(actionValues?: FBInsightAction[]): number {
  if (!actionValues) return 0;
  const purchaseValue = actionValues.find(
    (a) =>
      a.action_type === 'purchase' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase'
  );
  return purchaseValue ? parseFloat(purchaseValue.value) : 0;
}

/** Convert FB daily_budget (in cents) to dollar amount */
export function parseFBBudget(budgetCents?: string): number {
  if (!budgetCents) return 0;
  return parseInt(budgetCents, 10) / 100;
}

/** Calculate FB-reported ROAS from insight data */
export function calculateFBRoas(insight: FBInsight): number | null {
  const revenue = extractPurchaseRevenue(insight.action_values);
  const spend = parseFloat(insight.spend);
  if (spend === 0) return null;
  return revenue / spend;
}

/**
 * Validate a Facebook access token by making a debug_token call.
 * Returns true if valid, false otherwise.
 */
export async function validateFacebookToken(
  accessToken: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const url = `${FB_API_BASE}/v21.0/me?access_token=${accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { valid: false, error: data.error.message };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}
