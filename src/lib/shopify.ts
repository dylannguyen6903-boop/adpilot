/**
 * Shopify Admin API Client for AdPilot
 * 
 * Uses GraphQL Admin API to fetch:
 * - Orders (revenue, AOV, order count)
 * - Customer data (for LTV tracking)
 */

import { convertToAdAccountDate } from '@/lib/timezone';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getShopifyConfig,
  isShopifyConfigured,
  normalizeShopifyConfig,
  type ShopifyConfig,
} from '@/lib/shopifyConfig';

export { getShopifyConfig, isShopifyConfigured, type ShopifyConfig };

// ─────────────────────────────────────────────
// Token Refresh Logic (Expiring Offline Tokens)
// ─────────────────────────────────────────────

export interface ShopifyOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  shop: string;
}

export interface ShopifyTokenRefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope: string;
}

/** Refresh an expired Shopify access token using the refresh token */
export async function refreshShopifyAccessToken(
  creds: ShopifyOAuthCredentials
): Promise<ShopifyTokenRefreshResult> {
  const shop = creds.shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify token refresh failed (${response.status}): ${text}`);
  }

  return response.json();
}

/**
 * Get a valid Shopify config, auto-refreshing the token if expired.
 * Priority: check DB for token + expiry → refresh if needed → fallback to env.
 */
export async function getValidShopifyConfig(): Promise<ShopifyConfig> {
  const { data: profile } = await supabaseAdmin
    .from('business_profiles')
    .select('shopify_store_domain, shopify_access_token, shopify_refresh_token, shopify_token_expires_at, shopify_client_id, shopify_client_secret')
    .limit(1)
    .single();

  if (!profile?.shopify_store_domain || !profile?.shopify_access_token) {
    return getShopifyConfig();
  }

  const now = new Date();
  const expiresAt = profile.shopify_token_expires_at
    ? new Date(profile.shopify_token_expires_at)
    : null;

  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  if (!expiresAt || expiresAt.getTime() - now.getTime() > REFRESH_BUFFER_MS) {
    return {
      storeDomain: profile.shopify_store_domain,
      accessToken: profile.shopify_access_token,
    };
  }

  if (!profile.shopify_refresh_token || !profile.shopify_client_id || !profile.shopify_client_secret) {
    console.warn('[Shopify] Token expired but no refresh credentials available.');
    return {
      storeDomain: profile.shopify_store_domain,
      accessToken: profile.shopify_access_token,
    };
  }

  console.log('[Shopify] Access token expired, refreshing...');
  try {
    const result = await refreshShopifyAccessToken({
      clientId: profile.shopify_client_id,
      clientSecret: profile.shopify_client_secret,
      refreshToken: profile.shopify_refresh_token,
      shop: profile.shopify_store_domain,
    });

    const newExpiresAt = new Date(now.getTime() + result.expires_in * 1000).toISOString();
    const newRefreshExpiresAt = result.refresh_token_expires_in
      ? new Date(now.getTime() + result.refresh_token_expires_in * 1000).toISOString()
      : null;

    await supabaseAdmin
      .from('business_profiles')
      .update({
        shopify_access_token: result.access_token,
        shopify_refresh_token: result.refresh_token,
        shopify_token_expires_at: newExpiresAt,
        ...(newRefreshExpiresAt ? { shopify_refresh_token_expires_at: newRefreshExpiresAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('shopify_store_domain', profile.shopify_store_domain);

    console.log(`[Shopify] Token refreshed. New expiry: ${newExpiresAt}`);
    return {
      storeDomain: profile.shopify_store_domain,
      accessToken: result.access_token,
    };
  } catch (err) {
    console.error('[Shopify] Token refresh failed:', err);
    return {
      storeDomain: profile.shopify_store_domain,
      accessToken: profile.shopify_access_token,
    };
  }
}

export class ShopifyApiError extends Error {
  status: number;
  statusText: string;
  domain: string;

  constructor(status: number, statusText: string, domain: string, detail?: string) {
    const action = status === 401
      ? 'Reconnect Shopify in Settings or update SHOPIFY_ACCESS_TOKEN.'
      : 'Check Shopify Admin API configuration.';
    super(`Shopify API error (${status}): ${statusText} for ${domain}. ${detail ? `${detail} ` : ''}${action}`);
    this.name = 'ShopifyApiError';
    this.status = status;
    this.statusText = statusText;
    this.domain = domain;
  }
}

export function isShopifyUnauthorizedError(error: unknown): boolean {
  return error instanceof ShopifyApiError && error.status === 401;
}

// ─────────────────────────────────────────────
// Types for Shopify API responses
// ─────────────────────────────────────────────

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyLineItem {
  title: string;
  quantity: number;
  sku: string | null;
}

export interface ShopifyCustomer {
  email: string | null;
  numberOfOrders: string;     // GraphQL returns as string
  firstName: string | null;
  lastName: string | null;
}

export interface ShopifyOrder {
  id: string;
  name: string;            // e.g. "#1042"
  createdAt: string;
  totalPriceSet: {
    shopMoney: ShopifyMoney;
  };
  subtotalPriceSet: {
    shopMoney: ShopifyMoney;
  };
  customer: ShopifyCustomer | null;
  lineItems: {
    edges: Array<{
      node: ShopifyLineItem;
    }>;
  };
}

export interface ShopifyOrdersResponse {
  data: {
    orders: {
      edges: Array<{
        node: ShopifyOrder;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

// ─────────────────────────────────────────────
// Parsed types for internal use
// ─────────────────────────────────────────────

export interface ParsedOrder {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: number;
  subtotalPrice: number;
  customerEmail: string | null;
  customerOrdersCount: number;
  isReturningCustomer: boolean;
  lineItems: Array<{
    title: string;
    quantity: number;
    sku: string | null;
  }>;
}

export interface DailyRevenueSummary {
  date: string;          // YYYY-MM-DD
  revenue: number;
  orderCount: number;
  aov: number;
  returningCustomerOrders: number;
}

export interface CustomerSummary {
  email: string;
  totalOrders: number;
  totalRevenue: number;
  firstOrderDate: string;
  isReturning: boolean;
}

// ─────────────────────────────────────────────
// GraphQL Queries
// ─────────────────────────────────────────────

const ORDERS_QUERY = `
  query FetchOrders($query: String!, $first: Int!, $after: String) {
    orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            email
            numberOfOrders
            firstName
            lastName
          }
          lineItems(first: 20) {
            edges {
              node {
                title
                quantity
                sku
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ─────────────────────────────────────────────
// API Methods
// ─────────────────────────────────────────────

/**
 * Make a GraphQL request to Shopify Admin API.
 * On 401, attempts one automatic token refresh before failing.
 */
async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  config: ShopifyConfig,
  _retried = false
): Promise<T> {
  const normalizedConfig = normalizeShopifyConfig(config);
  const domain = normalizedConfig.storeDomain;
  const url = `https://${domain}/admin/api/2026-04/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': normalizedConfig.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  // Auto-retry on 401: refresh token and try once more
  if (response.status === 401 && !_retried) {
    console.warn(`[Shopify] 401 Unauthorized for ${domain}. Attempting token refresh...`);
    try {
      const refreshedConfig = await getValidShopifyConfig();
      if (refreshedConfig.accessToken !== normalizedConfig.accessToken) {
        return shopifyGraphQL<T>(query, variables, refreshedConfig, true);
      }
    } catch (refreshErr) {
      console.error('[Shopify] Auto-refresh on 401 failed:', refreshErr);
    }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ShopifyApiError(response.status, response.statusText, domain, detail.trim() || undefined);
  }

  const result = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Shopify GraphQL error: ${result.errors[0].message}`);
  }

  return result;
}

/**
 * Fetch orders from Shopify for a date range.
 * Handles pagination automatically.
 */
export async function fetchOrders(
  dateFrom: string,   // YYYY-MM-DD
  dateTo: string,     // YYYY-MM-DD
  config?: ShopifyConfig
): Promise<ParsedOrder[]> {
  const cfg = config || getShopifyConfig();
  if (!isShopifyConfigured(cfg)) {
    throw new Error('Shopify not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN.');
  }

  const allOrders: ParsedOrder[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const queryFilter = `created_at:>='${dateFrom}' AND created_at:<='${dateTo}T23:59:59'`;

  while (hasNextPage) {
    const variables: Record<string, unknown> = {
      query: queryFilter,
      first: 50,
      ...(cursor ? { after: cursor } : {}),
    };

    const result = await shopifyGraphQL<ShopifyOrdersResponse>(
      ORDERS_QUERY,
      variables,
      cfg
    );

    const edges = result.data.orders.edges;
    for (const edge of edges) {
      allOrders.push(parseShopifyOrder(edge.node));
    }

    hasNextPage = result.data.orders.pageInfo.hasNextPage;
    cursor = result.data.orders.pageInfo.endCursor;
  }

  return allOrders;
}

/**
 * Fetch orders for a single day.
 */
export async function fetchOrdersForDay(
  date: string,      // YYYY-MM-DD
  config?: ShopifyConfig
): Promise<ParsedOrder[]> {
  return fetchOrders(date, date, config);
}

// ─────────────────────────────────────────────
// Data Parsing & Aggregation
// ─────────────────────────────────────────────

/** Parse a Shopify order node into our internal format */
function parseShopifyOrder(order: ShopifyOrder): ParsedOrder {
  const customerOrdersCount = order.customer
    ? parseInt(order.customer.numberOfOrders, 10)
    : 0;

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    totalPrice: parseFloat(order.totalPriceSet.shopMoney.amount),
    subtotalPrice: parseFloat(order.subtotalPriceSet.shopMoney.amount),
    customerEmail: order.customer?.email || null,
    customerOrdersCount,
    isReturningCustomer: customerOrdersCount > 1,
    lineItems: order.lineItems.edges.map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      sku: e.node.sku,
    })),
  };
}

/** Aggregate orders into daily revenue summaries */
export function aggregateOrdersByDay(orders: ParsedOrder[]): DailyRevenueSummary[] {
  const dailyMap = new Map<string, { revenue: number; count: number; returning: number }>();

  for (const order of orders) {
    const date = convertToAdAccountDate(order.createdAt); // Align with FB timezone (GMT-7)
    const existing = dailyMap.get(date) || { revenue: 0, count: 0, returning: 0 };

    // Use totalPrice (Gross Sales) to match Shopify dashboard exactly
    existing.revenue += order.totalPrice;
    existing.count += 1;
    if (order.isReturningCustomer) {
      existing.returning += 1;
    }

    dailyMap.set(date, existing);
  }

  return Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      revenue: Math.round(data.revenue * 100) / 100,
      orderCount: data.count,
      aov: data.count > 0 ? Math.round((data.revenue / data.count) * 100) / 100 : 0,
      returningCustomerOrders: data.returning,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Build customer summaries from orders for LTV tracking */
export function buildCustomerSummaries(orders: ParsedOrder[]): CustomerSummary[] {
  const customerMap = new Map<string, CustomerSummary>();

  for (const order of orders) {
    if (!order.customerEmail) continue;

    const existing = customerMap.get(order.customerEmail);
    if (existing) {
      existing.totalOrders += 1;
      // Use totalPrice (Gross Sales) to match Shopify dashboard exactly
      existing.totalRevenue += order.totalPrice;
      if (order.createdAt < existing.firstOrderDate) {
        existing.firstOrderDate = order.createdAt;
      }
      existing.isReturning = true;
    } else {
      customerMap.set(order.customerEmail, {
        email: order.customerEmail,
        totalOrders: 1,
        totalRevenue: order.totalPrice,
        firstOrderDate: order.createdAt,
        isReturning: order.isReturningCustomer,
      });
    }
  }

  return Array.from(customerMap.values());
}

/**
 * Validate Shopify connection by making a simple shop query.
 */
export async function validateShopifyConnection(
  config?: ShopifyConfig
): Promise<{ valid: boolean; shopName?: string; error?: string }> {
  const cfg = config || getShopifyConfig();

  try {
    const result = await shopifyGraphQL<{ data: { shop: { name: string } } }>(
      `{ shop { name } }`,
      {},
      cfg
    );
    return { valid: true, shopName: result.data.shop.name };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}
