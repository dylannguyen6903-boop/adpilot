export type ShopifyConfigSource = 'request' | 'database' | 'environment';

export interface ShopifyConfig {
  storeDomain: string;
  accessToken: string;
  source?: ShopifyConfigSource;
}

export function normalizeShopifyStoreDomain(storeDomain: string): string {
  return storeDomain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^admin\./i, '')
    .replace(/\/admin\/?.*$/i, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function normalizeShopifyAccessToken(accessToken: string): string {
  return accessToken.trim();
}

export function normalizeShopifyConfig(config: ShopifyConfig): ShopifyConfig {
  return {
    storeDomain: normalizeShopifyStoreDomain(config.storeDomain),
    accessToken: normalizeShopifyAccessToken(config.accessToken),
    source: config.source,
  };
}

export function getShopifyConfig(overrides?: Partial<ShopifyConfig>): ShopifyConfig {
  return normalizeShopifyConfig({
    storeDomain: overrides?.storeDomain || process.env.SHOPIFY_STORE_DOMAIN || '',
    accessToken: overrides?.accessToken || process.env.SHOPIFY_ACCESS_TOKEN || '',
    source: overrides?.source || 'environment',
  });
}

export function isShopifyConfigured(config?: ShopifyConfig): boolean {
  const cfg = normalizeShopifyConfig(config || getShopifyConfig());
  return !!(cfg.storeDomain && cfg.accessToken);
}

function addCandidate(
  candidates: ShopifyConfig[],
  seen: Set<string>,
  config: Partial<ShopifyConfig> | undefined,
  source: ShopifyConfigSource
) {
  if (!config?.storeDomain || !config?.accessToken) return;

  const normalized = normalizeShopifyConfig({
    storeDomain: config.storeDomain,
    accessToken: config.accessToken,
    source,
  });
  if (!isShopifyConfigured(normalized)) return;

  const key = `${normalized.storeDomain}:${normalized.accessToken}`;
  if (seen.has(key)) return;

  seen.add(key);
  candidates.push(normalized);
}

export function getShopifyConfigCandidates(input?: {
  request?: Partial<ShopifyConfig>;
  database?: Partial<ShopifyConfig>;
}): ShopifyConfig[] {
  const candidates: ShopifyConfig[] = [];
  const seen = new Set<string>();

  addCandidate(candidates, seen, input?.request, 'request');
  addCandidate(candidates, seen, input?.database, 'database');
  addCandidate(candidates, seen, getShopifyConfig(), 'environment');

  return candidates;
}
