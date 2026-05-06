const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

type FetchImpl = typeof fetch;

export interface ShopifyClientCredentialsInput {
  shop: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchImpl;
}

export interface ShopifyClientCredentialsToken {
  accessToken: string;
  scope: string | null;
  expiresIn: number | null;
}

function getResponseDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  if (typeof record.error_description === 'string') return record.error_description;
  if (typeof record.error === 'string') return record.error;
  return '';
}

function normalizeShopifyStoreDomain(storeDomain: string): string {
  const cleaned = storeDomain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '');

  const adminStoreMatch = cleaned.match(/^admin\.shopify\.com\/store\/([^/?#]+)/i);
  if (adminStoreMatch) {
    return `${adminStoreMatch[1].toLowerCase()}.myshopify.com`;
  }

  return cleaned
    .replace(/^admin\./i, '')
    .replace(/\/admin\/?.*$/i, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

export async function requestShopifyClientCredentialsToken({
  shop,
  clientId,
  clientSecret,
  fetchImpl = fetch,
}: ShopifyClientCredentialsInput): Promise<ShopifyClientCredentialsToken> {
  const normalizedShop = normalizeShopifyStoreDomain(shop);

  if (!SHOPIFY_DOMAIN_REGEX.test(normalizedShop)) {
    throw new Error('Invalid shop domain. Must be *.myshopify.com');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
  });

  const response = await fetchImpl(`https://${normalizedShop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!response.ok) {
    const detail = getResponseDetail(data);
    throw new Error(`Shopify token request failed (${response.status}): ${detail || response.statusText}`);
  }

  if (!data || typeof data.access_token !== 'string') {
    throw new Error('Shopify token response did not include access_token.');
  }

  return {
    accessToken: data.access_token,
    scope: typeof data.scope === 'string' ? data.scope : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
  };
}
