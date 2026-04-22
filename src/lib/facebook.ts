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

/** Sleep helper for rate limit delays */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Make a request to Facebook Graph API with retry on rate limit */
async function fbRequest<T>(
  endpoint: string,
  config: FacebookConfig,
  params: Record<string, string> = {},
  retries = 3
): Promise<FBResponse<T>> {
  const url = new URL(`${FB_API_BASE}/${config.apiVersion}/${endpoint}`);
  url.searchParams.set('access_token', config.accessToken);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
    });

    if (response.status === 403 || response.status === 429) {
      // Rate limited — wait and retry with exponential backoff
      const waitMs = Math.min(1000 * Math.pow(2, attempt + 1), 30000); // 2s, 4s, 8s, max 30s
      console.warn(`[FB API] Rate limited (attempt ${attempt + 1}/${retries + 1}), waiting ${waitMs}ms...`);
      if (attempt < retries) {
        await sleep(waitMs);
        continue;
      }
    }

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

  throw new Error('Facebook API: Max retries exceeded');
}

/** Fetch paginated results with delay between pages to avoid rate limits */
async function fetchPaginated<T>(nextUrl: string, results: T[]): Promise<void> {
  let url: string | undefined = nextUrl;
  while (url) {
    await sleep(500); // 500ms delay between pagination requests
    const pageRes = await fetch(url);

    if (pageRes.status === 403 || pageRes.status === 429) {
      // Rate limited during pagination — wait and retry once
      console.warn('[FB API] Rate limited during pagination, waiting 5s...');
      await sleep(5000);
      const retryRes = await fetch(url);
      if (!retryRes.ok) {
        console.warn('[FB API] Pagination retry failed, returning partial results');
        return; // Return partial results instead of throwing
      }
      const retryData: FBResponse<T> = await retryRes.json();
      results.push(...retryData.data);
      url = retryData.paging?.next;
      continue;
    }

    const pageData: FBResponse<T> = await pageRes.json();
    results.push(...pageData.data);
    url = pageData.paging?.next;
  }
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

  // Paginate if needed (with rate limit protection)
  if (nextUrl) {
    await fetchPaginated<FBCampaign>(nextUrl, allCampaigns);
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

  // Only fetch insights for campaigns that had delivery (spend > 0)
  // This dramatically reduces API load for accounts with many paused campaigns
  const filtering = JSON.stringify([
    { field: 'spend', operator: 'GREATER_THAN', value: '0' },
  ]);

  const result = await fbRequest<FBInsight>(
    `act_${cfg.adAccountId.replace('act_', '')}/insights`,
    cfg,
    {
      fields,
      time_range: timeRange,
      time_increment: '1',       // Daily breakdown
      level: 'campaign',
      filtering,                 // Only campaigns with spend > 0
      limit: '500',
    }
  );

  if (result.error) {
    throw new Error(`Facebook API: ${result.error.message}`);
  }

  allInsights.push(...result.data);
  nextUrl = result.paging?.next;

  // Paginate with rate limit protection
  if (nextUrl) {
    await fetchPaginated<FBInsight>(nextUrl, allInsights);
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

/** Extract Add to Cart count from FB actions array */
export function extractAddToCart(actions?: FBInsightAction[]): number {
  if (!actions) return 0;
  const atc = actions.find(
    (a) =>
      a.action_type === 'add_to_cart' ||
      a.action_type === 'omni_add_to_cart' ||
      a.action_type === 'offsite_conversion.fb_pixel_add_to_cart'
  );
  return atc ? parseInt(atc.value, 10) : 0;
}

/** Extract Initiate Checkout count from FB actions array */
export function extractInitiateCheckout(actions?: FBInsightAction[]): number {
  if (!actions) return 0;
  const ic = actions.find(
    (a) =>
      a.action_type === 'initiate_checkout' ||
      a.action_type === 'omni_initiate_checkout' ||
      a.action_type === 'offsite_conversion.fb_pixel_initiate_checkout'
  );
  return ic ? parseInt(ic.value, 10) : 0;
}

/** Extract Landing Page Views from FB actions array */
export function extractLandingPageViews(actions?: FBInsightAction[]): number {
  if (!actions) return 0;
  const lpv = actions.find((a) => a.action_type === 'landing_page_view');
  return lpv ? parseInt(lpv.value, 10) : 0;
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
