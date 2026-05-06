import assert from 'node:assert/strict';
import test from 'node:test';

import { requestShopifyClientCredentialsToken } from './shopifyToken.ts';

test('requests a Shopify token with client credentials grant', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      access_token: 'fresh_token',
      scope: 'read_orders,read_products,read_customers',
      expires_in: 86399,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const token = await requestShopifyClientCredentialsToken({
    shop: ' https://admin.shopify.com/store/tkww3m-6u/ ',
    clientId: 'client_123',
    clientSecret: 'secret_456',
    fetchImpl,
  });

  assert.equal(token.accessToken, 'fresh_token');
  assert.equal(token.expiresIn, 86399);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://tkww3m-6u.myshopify.com/admin/oauth/access_token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[0].init.body.toString(), 'grant_type=client_credentials&client_id=client_123&client_secret=secret_456');
});

test('surfaces Shopify token errors with response detail', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: 'invalid_client',
    error_description: 'Client credentials are invalid',
  }), {
    status: 401,
    statusText: 'Unauthorized',
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(
    requestShopifyClientCredentialsToken({
      shop: 'tkww3m-6u.myshopify.com',
      clientId: 'bad',
      clientSecret: 'bad',
      fetchImpl,
    }),
    /Shopify token request failed \(401\): Client credentials are invalid/
  );
});
