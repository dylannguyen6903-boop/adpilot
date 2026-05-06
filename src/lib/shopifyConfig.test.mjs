import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getShopifyConfigCandidates,
  normalizeShopifyConfig,
} from './shopifyConfig.ts';

test('normalizes Shopify store domains and access tokens from copied settings', () => {
  assert.deepEqual(
    normalizeShopifyConfig({
      storeDomain: ' https://example.myshopify.com/admin/ ',
      accessToken: ' shpat_abc123 \n',
      source: 'database',
    }),
    {
      storeDomain: 'example.myshopify.com',
      accessToken: 'shpat_abc123',
      source: 'database',
    }
  );
});

test('builds sync credential candidates in request, database, then environment order', () => {
  const previousDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const previousToken = process.env.SHOPIFY_ACCESS_TOKEN;
  process.env.SHOPIFY_STORE_DOMAIN = 'env.myshopify.com';
  process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_env';

  try {
    assert.deepEqual(
      getShopifyConfigCandidates({
        request: { storeDomain: 'body.myshopify.com', accessToken: 'shpat_body' },
        database: { storeDomain: 'db.myshopify.com', accessToken: 'shpat_db' },
      }),
      [
        { storeDomain: 'body.myshopify.com', accessToken: 'shpat_body', source: 'request' },
        { storeDomain: 'db.myshopify.com', accessToken: 'shpat_db', source: 'database' },
        { storeDomain: 'env.myshopify.com', accessToken: 'shpat_env', source: 'environment' },
      ]
    );
  } finally {
    if (previousDomain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
    else process.env.SHOPIFY_STORE_DOMAIN = previousDomain;
    if (previousToken === undefined) delete process.env.SHOPIFY_ACCESS_TOKEN;
    else process.env.SHOPIFY_ACCESS_TOKEN = previousToken;
  }
});

test('deduplicates identical database and environment credentials', () => {
  const previousDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const previousToken = process.env.SHOPIFY_ACCESS_TOKEN;
  process.env.SHOPIFY_STORE_DOMAIN = 'same.myshopify.com';
  process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_same';

  try {
    assert.deepEqual(
      getShopifyConfigCandidates({
        database: { storeDomain: 'same.myshopify.com', accessToken: 'shpat_same' },
      }),
      [
        { storeDomain: 'same.myshopify.com', accessToken: 'shpat_same', source: 'database' },
      ]
    );
  } finally {
    if (previousDomain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
    else process.env.SHOPIFY_STORE_DOMAIN = previousDomain;
    if (previousToken === undefined) delete process.env.SHOPIFY_ACCESS_TOKEN;
    else process.env.SHOPIFY_ACCESS_TOKEN = previousToken;
  }
});
