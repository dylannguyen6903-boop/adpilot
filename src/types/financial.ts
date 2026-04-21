/* ============================================
   Financial & Margin Type Definitions
   ============================================ */

/** Daily margin status */
export type MarginStatus = 'CRITICAL' | 'ON_TARGET' | 'HEALTHY';

/** Daily financial snapshot */
export interface DailyFinancial {
  id: string;
  profileId: string;
  reportDate: string;

  // Revenue
  shopifyRevenue: number;
  shopifyOrders: number;
  shopifyAov: number | null;

  // Costs
  totalAdSpend: number;
  estimatedCogs: number;

  // Profitability
  grossProfit: number | null;
  netProfit: number | null;
  dailyMargin: number | null;      // as decimal (0.17 = 17%)
  marginStatus: MarginStatus;

  // FB vs Shopify discrepancy
  fbReportedConversions: number;
  shopifyActualOrders: number;
  discrepancyCount: number;
  trueRoas: number | null;

  createdAt: string;
}

/** Margin alert for display */
export interface MarginAlert {
  status: MarginStatus;
  margin: number;                  // as decimal
  marginPercent: string;           // formatted "17.4%"
  message: string;
  icon: string;
}

/** Customer LTV record */
export interface CustomerLTV {
  id: string;
  profileId: string;
  customerEmail: string;
  firstOrderDate: string;
  totalOrders: number;
  totalRevenue: number;
  totalCogs: number;
  estimatedLtv: number;
  isReturning: boolean;
  firstOrderCampaignId: string | null;
  firstOrderCpa: number | null;
  ltvToCpaRatio: number | null;
  createdAt: string;
  updatedAt: string;
}

/** LTV calculation parameters */
export interface LTVParams {
  returningRate: number;           // 0.22
  avgRepeatOrders: number;         // 1.5
  aov: number;                     // 87
  targetMarginMin: number;         // 0.17
  targetMarginMax: number;         // 0.20
}

/** LTV calculation result */
export interface LTVResult {
  ltvFactor: number;               // 1 + (returning_rate × avg_repeat_orders)
  customerLtv: number;             // AOV × LTV_Factor
  ltvProfit: number;               // customerLtv × margin
  maxAllowableCpa: number;         // ltvProfit
  maxAllowableCpaCeiling: number;  // using max margin
  maxAllowableCpaFloor: number;    // using min margin
}

/** Dashboard KPI summary */
export interface DashboardKPIs {
  totalSpend: number;
  shopifyRevenue: number;
  trueRoas: number | null;
  avgCpa: number | null;
  activeCampaigns: number;
  dailyMargin: number | null;
  marginStatus: MarginStatus;
  blendedMer: number | null;       // Total Revenue / Total Ad Spend
  healthScore: number;             // 0-100
}

/** Sync log entry */
export interface SyncLog {
  id: string;
  profileId: string;
  syncType: 'FACEBOOK' | 'SHOPIFY' | 'FULL';
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  campaignsSynced: number;
  ordersSynced: number;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}
