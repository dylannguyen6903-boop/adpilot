/* ============================================
   Action Plan Type Definitions
   ============================================ */

/** Action type in a plan */
export type ActionType = 'SCALE' | 'KILL' | 'WATCH' | 'OPPORTUNITY' | 'REVERT' | 'LAUNCH';

/** A single action item in an action plan */
export interface ActionItem {
  id: string;
  type: ActionType;
  campaignId: string;
  campaignName: string;
  adAccountId?: string;
  description: string;            // Short summary, e.g. "Tăng budget từ $10 → $12/day"
  reason: string;                 // Why this action, e.g. "CPA $33.76 < target, stable 7 ngày"
  oldBudget: number | null;
  newBudget: number | null;
  currentCpa: number | null;
  currentLtvCpa: number | null;
  isCompleted: boolean;
  completedAt: string | null;
  // AI V2 fields
  aiReasoning: string | null;
  aiPrediction: string | null;
  aiConfidence: number | null;  // 0-100
  // V3 evaluation fields
  lifecycle?: string;            // LEARNING, EVALUATING, PERFORMING, SCALING, FATIGUED
  campType?: string;             // PROSPECTING, RETARGETING, MIXED
  funnelHealth?: number;         // 0-100
  profitPerOrder?: number | null;
  diagnosis?: string;            // Metric combo pattern description
  // Growth scale readiness fields
  readinessScore?: number;       // 0-100 score for scale readiness
  readinessLabel?: string;       // SCALE_READY, OPPORTUNITY, SCALE_BLOCKED, NOT_READY
  blockers?: string[];           // Hard risk blocks preventing scale
  missingSignals?: string[];     // Missing data/stability signals
  recommendedNextStep?: string;  // Human-readable next step
  // V3.1 — additional metrics for detailed UI
  spend7d?: number;              // Total spend over 7 days
  conversions7d?: number;        // Total orders over 7 days
  spendToday?: number;           // Today's spend
  ctr7d?: number;                // Average CTR over 7 days
  atc7d?: number;                // Add to cart events over 7 days
  ic7d?: number;                 // Initiate checkout events over 7 days
  roas7d?: number | null;        // 7-day ROAS
  daysRunning?: number;          // Number of days with spend
  // V3.2 — Creative health fields
  frequency7d?: number;           // Average frequency over 7 days
  cpm7d?: number;                 // Average CPM over 7 days
  ctrTrend?: string;              // 'UP' | 'DOWN' | 'STABLE'
}

/** Full action plan for a day */
export interface ActionPlan {
  id: string;
  profileId: string;
  planDate: string;               // ISO date

  actions: ActionItem[];

  // Summary stats
  scaleCount: number;
  killCount: number;
  watchCount: number;
  projectedMargin: number | null;  // If all actions executed
  budgetSaved: number | null;      // From kills

  // Execution tracking
  wasExecuted: boolean;
  executionNotes: string | null;
  actualMarginNextDay: number | null;

  createdAt: string;
}

/** Budget allocation recommendation */
export interface BudgetAllocation {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  recommendedBudget: number;
  changePercent: number;            // positive = increase
  performanceScore: number;
  status: string;
}

/** Budget simulation result */
export interface BudgetSimulation {
  totalBudget: number;
  allocations: BudgetAllocation[];
  projectedMargin: number;
  projectedRoas: number | null;
  projectedCpa: number | null;
  budgetUtilization: number;        // % of budget allocated to WINNERs
}
