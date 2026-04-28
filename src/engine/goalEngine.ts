/**
 * Goal-Driven Planning Engine for AdPilot V3.0
 *
 * Takes a monthly profit target and reverse-engineers daily requirements.
 * Generates gap analysis and per-campaign recommendations.
 *
 * Core formula:
 *   Profit/Order = AOV × (1 - COGS_rate) - CPA
 *   Daily Target = (Monthly Target ÷ 30) × Safety Buffer
 *   Orders Needed = Daily Target ÷ Profit/Order
 */

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface GoalConfig {
  monthlyProfitTarget: number;   // e.g. 15000
  aov: number;                   // e.g. 86
  avgCogsRate: number;           // e.g. 0.20
  targetCpa: number;             // e.g. 40
  safetyBuffer: number;          // e.g. 1.10 (10% buffer)
}

export interface ActualMetrics {
  todayRevenue: number;
  todayAdSpend: number;
  todayOrders: number;
  todayCpa: number | null;
  monthToDateProfit: number;
  monthToDateRevenue: number;
  monthToDateAdSpend: number;
  monthToDateOrders: number;
  daysElapsed: number;           // Day of month (1-30)
  daysRemaining: number;
}

export interface CampaignForGoal {
  campaignId: string;
  campaignName: string;
  status: string;                // SCALE_READY, OPPORTUNITY, PERFORMING, WATCH, KILL, LEARNING
  readinessScore?: number;
  readinessLabel?: string;
  spend: number;
  conversions: number;
  cpa: number | null;
  dailyBudget: number;
  roas: number | null;
}

export interface GoalRecommendation {
  type: 'SCALE_CAMPAIGN' | 'KILL_CAMPAIGN' | 'INCREASE_BUDGET' | 'REDUCE_CPA';
  campaignId?: string;
  campaignName?: string;
  description: string;
  impact: string;                // e.g. "Thêm ~$50/ngày profit"
  impactValue: number;           // Dollar impact per day
  confidence: number;            // 0-100
  currentBudget?: number;
  suggestedBudget?: number;
  currentCpa?: number;
}

export interface CpaSensitivity {
  cpa: number;
  profitPerOrder: number;
  dailyProfit: number;           // At current order rate
  monthlyProfit: number;
  status: 'good' | 'warning' | 'danger';
}

export interface GoalBreakdown {
  // Configuration
  monthlyTarget: number;
  safetyBuffer: number;

  // Calculated daily targets (with buffer)
  dailyProfitTarget: number;
  dailyRevenueNeeded: number;
  dailyOrdersNeeded: number;
  dailyAdBudgetNeeded: number;
  profitPerOrder: number;

  // Actual metrics
  actual: ActualMetrics;

  // Gap analysis
  dailyProfitGap: number;          // positive = behind target
  dailyProfitGapPercent: number;
  isOnTrack: boolean;
  trackingStatus: 'ahead' | 'on_track' | 'behind' | 'critical';

  // Monthly projection
  projectedMonthlyProfit: number;
  monthlyProgressPercent: number;  // actual / target × 100
  projectedMonthlyStatus: 'exceed' | 'on_track' | 'miss';
  amountNeededRestOfMonth: number; // How much more profit needed

  // CPA sensitivity
  cpaSensitivity: CpaSensitivity[];

  // Per-campaign recommendations
  recommendations: GoalRecommendation[];
}

// ─────────────────────────────────────────
// Main Engine
// ─────────────────────────────────────────

const SAFETY_BUFFER_DEFAULT = 1.10;

/**
 * Calculate the full goal breakdown from monthly target and actual data.
 */
export function calculateGoalBreakdown(
  config: GoalConfig,
  actual: ActualMetrics,
  campaigns: CampaignForGoal[]
): GoalBreakdown {
  const buffer = config.safetyBuffer || SAFETY_BUFFER_DEFAULT;

  // ── Step 1: Calculate daily targets ──
  const profitPerOrder = config.aov * (1 - config.avgCogsRate) - config.targetCpa;
  const rawDailyTarget = config.monthlyProfitTarget / 30;
  const bufferedDailyTarget = rawDailyTarget * buffer;

  // Guard: if profit per order is 0 or negative, can't reach target
  const dailyOrdersNeeded = profitPerOrder > 0
    ? Math.ceil(bufferedDailyTarget / profitPerOrder)
    : 0;
  const dailyRevenueNeeded = dailyOrdersNeeded * config.aov;
  const dailyAdBudgetNeeded = dailyOrdersNeeded * config.targetCpa;

  // ── Step 2: Calculate actual daily profit ──
  const actualDailyProfit = actual.todayRevenue * (1 - config.avgCogsRate) - actual.todayAdSpend;

  // ── Step 3: Gap analysis ──
  const dailyProfitGap = bufferedDailyTarget - actualDailyProfit;
  const dailyProfitGapPercent = bufferedDailyTarget > 0
    ? (dailyProfitGap / bufferedDailyTarget) * 100
    : 0;
  const isOnTrack = actualDailyProfit >= rawDailyTarget; // Use raw (without buffer) for "on track"

  let trackingStatus: GoalBreakdown['trackingStatus'];
  if (actualDailyProfit >= bufferedDailyTarget) {
    trackingStatus = 'ahead';
  } else if (actualDailyProfit >= rawDailyTarget) {
    trackingStatus = 'on_track';
  } else if (actualDailyProfit >= rawDailyTarget * 0.5) {
    trackingStatus = 'behind';
  } else {
    trackingStatus = 'critical';
  }

  // ── Step 4: Monthly projection ──
  const avgDailyProfit = actual.daysElapsed > 0
    ? actual.monthToDateProfit / actual.daysElapsed
    : actualDailyProfit;
  const projectedMonthlyProfit = avgDailyProfit * 30;
  const monthlyProgressPercent = config.monthlyProfitTarget > 0
    ? (actual.monthToDateProfit / config.monthlyProfitTarget) * 100
    : 0;

  let projectedMonthlyStatus: GoalBreakdown['projectedMonthlyStatus'];
  if (projectedMonthlyProfit >= config.monthlyProfitTarget * 1.05) {
    projectedMonthlyStatus = 'exceed';
  } else if (projectedMonthlyProfit >= config.monthlyProfitTarget * 0.90) {
    projectedMonthlyStatus = 'on_track';
  } else {
    projectedMonthlyStatus = 'miss';
  }

  const amountNeededRestOfMonth = Math.max(0,
    config.monthlyProfitTarget - actual.monthToDateProfit
  );

  // ── Step 5: CPA sensitivity ──
  const cpaSensitivity = calculateCpaSensitivity(
    config.aov,
    config.avgCogsRate,
    config.targetCpa,
    actual.todayOrders || dailyOrdersNeeded
  );

  // ── Step 6: Generate recommendations ──
  const recommendations = generateRecommendations(
    config,
    campaigns,
    dailyProfitGap,
    profitPerOrder
  );

  return {
    monthlyTarget: config.monthlyProfitTarget,
    safetyBuffer: buffer,
    dailyProfitTarget: Math.round(bufferedDailyTarget * 100) / 100,
    dailyRevenueNeeded,
    dailyOrdersNeeded,
    dailyAdBudgetNeeded,
    profitPerOrder: Math.round(profitPerOrder * 100) / 100,
    actual,
    dailyProfitGap: Math.round(dailyProfitGap * 100) / 100,
    dailyProfitGapPercent: Math.round(dailyProfitGapPercent * 10) / 10,
    isOnTrack,
    trackingStatus,
    projectedMonthlyProfit: Math.round(projectedMonthlyProfit),
    monthlyProgressPercent: Math.round(monthlyProgressPercent * 10) / 10,
    projectedMonthlyStatus,
    amountNeededRestOfMonth: Math.round(amountNeededRestOfMonth),
    cpaSensitivity,
    recommendations,
  };
}

// ─────────────────────────────────────────
// CPA Sensitivity Analysis
// ─────────────────────────────────────────

function calculateCpaSensitivity(
  aov: number,
  cogsRate: number,
  baseCpa: number,
  dailyOrders: number
): CpaSensitivity[] {
  const grossMarginPerUnit = aov * (1 - cogsRate);
  const cpaSteps = [
    baseCpa - 10,
    baseCpa - 5,
    baseCpa,
    baseCpa + 5,
    baseCpa + 10,
    baseCpa + 15,
  ].filter(c => c > 0);

  return cpaSteps.map(cpa => {
    const profitPerOrder = grossMarginPerUnit - cpa;
    const dailyProfit = profitPerOrder * dailyOrders;
    const monthlyProfit = dailyProfit * 30;

    let status: CpaSensitivity['status'];
    if (profitPerOrder <= 0) {
      status = 'danger';
    } else if (monthlyProfit < 10000) { // Below reasonable threshold
      status = 'warning';
    } else {
      status = 'good';
    }

    return {
      cpa,
      profitPerOrder: Math.round(profitPerOrder * 100) / 100,
      dailyProfit: Math.round(dailyProfit),
      monthlyProfit: Math.round(monthlyProfit),
      status,
    };
  });
}

// ─────────────────────────────────────────
// Recommendation Engine
// ─────────────────────────────────────────

function generateRecommendations(
  config: GoalConfig,
  campaigns: CampaignForGoal[],
  dailyProfitGap: number,
  profitPerOrder: number
): GoalRecommendation[] {
  const recs: GoalRecommendation[] = [];

  if (profitPerOrder <= 0) {
    recs.push({
      type: 'REDUCE_CPA',
      description: `CPA ($${config.targetCpa}) ≥ biên lợi nhuận/đơn ($${(config.aov * (1 - config.avgCogsRate)).toFixed(0)}). Không thể đạt mục tiêu với các thông số hiện tại.`,
      impact: 'Cần giảm CPA hoặc tăng AOV trước khi scale',
      impactValue: 0,
      confidence: 95,
    });
    return recs;
  }

  // Sort campaigns by efficiency (lowest CPA first for winners)
  const activeCampaigns = campaigns.filter(c =>
    c.spend > 0 && c.cpa !== null && c.conversions > 0
  );

  // ── KILL recommendations: campaigns with CPA > 2× target ──
  const killCandidates = activeCampaigns
    .filter(c => c.cpa !== null && c.cpa > config.targetCpa * 2)
    .sort((a, b) => (b.cpa ?? 0) - (a.cpa ?? 0));

  for (const camp of killCandidates.slice(0, 5)) {
    recs.push({
      type: 'KILL_CAMPAIGN',
      campaignId: camp.campaignId,
      campaignName: camp.campaignName,
      description: `CPA $${camp.cpa!.toFixed(0)} gấp ${(camp.cpa! / config.targetCpa).toFixed(1)}× target. Kill để tiết kiệm budget.`,
      impact: `Tiết kiệm ~$${camp.dailyBudget.toFixed(0)}/ngày`,
      impactValue: camp.dailyBudget,
      confidence: 90,
      currentBudget: camp.dailyBudget,
      suggestedBudget: 0,
      currentCpa: camp.cpa!,
    });
  }

  // ── SCALE recommendations: Growth readiness candidates with CPA near target ──
  const scaleCandidates = activeCampaigns
    .filter(c =>
      (
        c.status === 'SCALING' ||
        c.status === 'SCALE_READY' ||
        c.status === 'OPPORTUNITY' ||
        c.status === 'PERFORMING' ||
        c.readinessLabel === 'SCALE_READY' ||
        c.readinessLabel === 'OPPORTUNITY'
      ) &&
      c.cpa !== null &&
      c.cpa <= config.targetCpa * 1.15
    )
    .sort((a, b) => (b.readinessScore ?? 0) - (a.readinessScore ?? 0) || (a.cpa ?? 999) - (b.cpa ?? 999));

  for (const camp of scaleCandidates.slice(0, 5)) {
    const changePercent = camp.dailyBudget >= 500 ? 5 : camp.dailyBudget >= 100 ? 15 : 20;
    const scaledBudget = Math.round(camp.dailyBudget * (1 + changePercent / 100) * 100) / 100;
    const budgetIncrease = scaledBudget - camp.dailyBudget;
    // Estimate additional orders from the budget increase
    const additionalOrders = camp.cpa! > 0 ? budgetIncrease / camp.cpa! : 0;
    const additionalProfit = additionalOrders * (config.aov * (1 - config.avgCogsRate) - camp.cpa!);

    recs.push({
      type: 'SCALE_CAMPAIGN',
      campaignId: camp.campaignId,
      campaignName: camp.campaignName,
      description: camp.readinessLabel === 'OPPORTUNITY'
        ? `CPA $${camp.cpa!.toFixed(0)} nằm trong ngưỡng Growth. Theo dõi để đủ điều kiện scale +${changePercent}%.`
        : `CPA $${camp.cpa!.toFixed(0)} nằm trong ngưỡng Growth. Có thể tăng budget +${changePercent}%.`,
      impact: `Thêm ~$${Math.max(0, Math.round(additionalProfit))}/ngày profit`,
      impactValue: Math.max(0, Math.round(additionalProfit)),
      confidence: camp.readinessLabel === 'SCALE_READY' || camp.status === 'SCALE_READY' || camp.status === 'SCALING'
        ? 85
        : Math.max(55, Math.min(75, camp.readinessScore ?? 65)),
      currentBudget: camp.dailyBudget,
      suggestedBudget: scaledBudget,
      currentCpa: camp.cpa!,
    });
  }

  // ── Budget increase recommendation if gap is large ──
  if (dailyProfitGap > 0 && profitPerOrder > 0) {
    const additionalOrdersNeeded = Math.ceil(dailyProfitGap / profitPerOrder);
    const additionalBudgetNeeded = additionalOrdersNeeded * config.targetCpa;

    recs.push({
      type: 'INCREASE_BUDGET',
      description: `Cần thêm ${additionalOrdersNeeded} đơn/ngày để đạt mục tiêu. Tăng tổng ngân sách ~$${additionalBudgetNeeded}/ngày.`,
      impact: `Lấp gap profit $${Math.round(dailyProfitGap)}/ngày`,
      impactValue: Math.round(dailyProfitGap),
      confidence: 70,
    });
  }

  // Sort by impact (highest first)
  recs.sort((a, b) => b.impactValue - a.impactValue);

  return recs;
}
