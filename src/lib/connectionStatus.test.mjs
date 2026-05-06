import assert from 'node:assert/strict';
import test from 'node:test';

import { getShopifyConnectionState } from './connectionStatus.ts';

test('marks configured Shopify connection with failed sync as reconnect required', () => {
  assert.deepEqual(
    getShopifyConnectionState({ configured: true, lastSyncStatus: 'FAILED' }),
    { label: 'Cần kết nối lại', tone: 'kill' }
  );
});

test('marks configured Shopify connection without failed sync as connected', () => {
  assert.deepEqual(
    getShopifyConnectionState({ configured: true, lastSyncStatus: 'SUCCESS' }),
    { label: 'Đã kết nối', tone: 'winner' }
  );
});

test('marks missing Shopify connection as disconnected', () => {
  assert.deepEqual(
    getShopifyConnectionState({ configured: false, lastSyncStatus: null }),
    { label: 'Chưa kết nối', tone: 'kill' }
  );
});
