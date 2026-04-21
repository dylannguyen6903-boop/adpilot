/* ============================================
   Action Plan Type Definitions
   ============================================ */

/** Action type in a plan */
export type ActionType = 'SCALE' | 'KILL' | 'WATCH' | 'REVERT' | 'LAUNCH';

/** A single action item in an action plan */
export interface ActionItem {
  id: string;
  type: ActionType;
  campaignId: string;
  campaignName: string;
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
