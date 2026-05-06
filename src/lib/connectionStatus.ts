export type ConnectionTone = 'winner' | 'kill';

export interface ShopifyConnectionInput {
  configured: boolean;
  lastSyncStatus: string | null;
}

export function getShopifyConnectionState(input: ShopifyConnectionInput): {
  label: string;
  tone: ConnectionTone;
} {
  if (!input.configured) {
    return { label: 'Chưa kết nối', tone: 'kill' };
  }

  if (input.lastSyncStatus === 'FAILED') {
    return { label: 'Cần kết nối lại', tone: 'kill' };
  }

  return { label: 'Đã kết nối', tone: 'winner' };
}
