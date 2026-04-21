/* ============================================
   Settings & Business Profile Type Definitions
   ============================================ */

/** Business profile / store configuration */
export interface BusinessProfile {
  id: string;
  userId: string;
  storeName: string;
  storeUrl: string | null;

  // Margin & Profitability
  targetMarginMin: number;        // 0.17 (17%)
  targetMarginMax: number;        // 0.20 (20%)
  avgCogsRate: number;            // 0.80 (80% of revenue)

  // CPA & LTV
  targetCpa: number;              // $40
  aov: number;                    // $87
  returningRate: number;          // 0.22 (22%)
  avgRepeatOrders: number;        // 1.5

  // API Connections
  fbAccessToken: string | null;
  fbAdAccountId: string | null;
  shopifyApiKey: string | null;
  shopifyApiSecret: string | null;
  shopifyStoreDomain: string | null;

  // Decision Thresholds
  thresholdWinner: number;        // 0.7
  thresholdPromising: number;     // 0.4
  thresholdWatch: number;         // 0.2

  createdAt: string;
  updatedAt: string;
}

/** Form data for updating business profile */
export interface BusinessProfileFormData {
  storeName: string;
  storeUrl: string;
  targetMarginMin: number;
  targetMarginMax: number;
  avgCogsRate: number;
  targetCpa: number;
  aov: number;
  returningRate: number;
  avgRepeatOrders: number;
  thresholdWinner: number;
  thresholdPromising: number;
  thresholdWatch: number;
}

/** API connection form data */
export interface ConnectionFormData {
  fbAccessToken: string;
  fbAdAccountId: string;
  shopifyApiKey: string;
  shopifyApiSecret: string;
  shopifyStoreDomain: string;
}

/** Connection status for display */
export interface ConnectionStatus {
  facebook: {
    connected: boolean;
    lastSync: string | null;
    accountName: string | null;
    error: string | null;
  };
  shopify: {
    connected: boolean;
    lastSync: string | null;
    storeName: string | null;
    error: string | null;
  };
}
