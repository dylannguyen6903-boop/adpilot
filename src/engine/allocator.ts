/**
 * Budget Allocator for AdPilot
 * 
 * Given a total daily budget, distributes it optimally across campaigns.
 * Algorithm: weighted allocation using inverse CPA × sqrt(conversions)
 * 
 * Constraints:
 * - Only WINNER + PROMISING campaigns receive allocation
 * - Max increase per campaign: 20% of current budget
 * - Min allocation: 80% of current budget (no drastic drops)
 * - Total allocation ≤ total daily budget
 * - Projected margin must stay ≥ 17%
 */

import type { CampaignStatus } from '@/types/campaign';
import type { BudgetAllocation, BudgetSimulation } from '@/types/plan';
import { calculateDailyMargin, type MarginConfig } from './margin';

export interface AllocatorCampaignInput {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  currentBudget: number;
  performanceScore: number;
  conversions: number;
  cpa: number | null;
  spend: number;
}

export interface AllocatorConfig {
  totalDailyBudget: number;
  marginConfig: MarginConfig;
  currentRevenue: number;          // Current daily Shopify revenue
  currentTotalSpend: number;       // Current total ad spend
  aov: number;
}

const MAX_CHANGE = 0.20;           // ±20%
const ELIGIBLE_STATUSES: CampaignStatus[] = ['WINNER', 'PROMISING'];

/**
 * Calculate optimal budget allocation across campaigns.
 */
export function allocateBudget(
  campaigns: AllocatorCampaignInput[],
  config: AllocatorConfig
): BudgetSimulation {
  const eligible = campaigns.filter((c) =>
    ELIGIBLE_STATUSES.includes(c.status) && c.currentBudget > 0
  );

  const ineligible = campaigns.filter((c) =>
    !ELIGIBLE_STATUSES.includes(c.status) || c.currentBudget <= 0
  );

  if (eligible.length === 0) {
    return {
      totalBudget: config.totalDailyBudget,
      allocations: campaigns.map((c) => ({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        currentBudget: c.currentBudget,
        recommendedBudget: 0,          // Kill everything if nothing is eligible
        changePercent: -100,
        performanceScore: c.performanceScore,
        status: c.status,
      })),
      projectedMargin: 0,
      projectedRoas: null,
      projectedCpa: null,
      budgetUtilization: 0,
    };
  }

  // ── Step 1: Calculate raw weights ──
  const weights: Map<string, number> = new Map();
  let totalWeight = 0;

  for (const c of eligible) {
    const inverseCpa = c.cpa && c.cpa > 0 ? 1 / c.cpa : 0;
    const convFactor = Math.sqrt(Math.max(1, c.conversions));
    const weight = c.performanceScore * convFactor * inverseCpa;
    weights.set(c.campaignId, weight);
    totalWeight += weight;
  }

  // ── Step 2: Calculate raw allocations ──
  const allocations: BudgetAllocation[] = [];
  let allocatedBudget = 0;

  for (const c of eligible) {
    const weight = weights.get(c.campaignId) || 0;
    const rawAllocation = totalWeight > 0
      ? (weight / totalWeight) * config.totalDailyBudget
      : config.totalDailyBudget / eligible.length;

    // Apply constraints: ±20% of current budget
    const minBudget = c.currentBudget * (1 - MAX_CHANGE);
    const maxBudget = c.currentBudget * (1 + MAX_CHANGE);
    const constrained = Math.max(minBudget, Math.min(maxBudget, rawAllocation));
    const rounded = Math.round(constrained * 100) / 100;

    const changePercent = c.currentBudget > 0
      ? ((rounded - c.currentBudget) / c.currentBudget) * 100
      : 0;

    allocations.push({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      currentBudget: c.currentBudget,
      recommendedBudget: rounded,
      changePercent: Math.round(changePercent * 10) / 10,
      performanceScore: c.performanceScore,
      status: c.status,
    });

    allocatedBudget += rounded;
  }

  // ── Step 2b: Enforce total budget cap ──
  // Min 80% constraints can push sum above totalDailyBudget.
  // Scale down proportionally to stay within the requested total.
  if (allocatedBudget > config.totalDailyBudget && config.totalDailyBudget > 0) {
    const scaleFactor = config.totalDailyBudget / allocatedBudget;
    allocatedBudget = 0;
    for (const a of allocations) {
      if (a.recommendedBudget > 0) {
        a.recommendedBudget = Math.round(a.recommendedBudget * scaleFactor * 100) / 100;
        a.changePercent = a.currentBudget > 0
          ? Math.round(((a.recommendedBudget - a.currentBudget) / a.currentBudget) * 1000) / 10
          : 0;
        allocatedBudget += a.recommendedBudget;
      }
    }
  }

  // Add ineligible campaigns with zero allocation
  for (const c of ineligible) {
    allocations.push({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      currentBudget: c.currentBudget,
      recommendedBudget: 0,
      changePercent: c.currentBudget > 0 ? -100 : 0,
      performanceScore: c.performanceScore,
      status: c.status,
    });
  }

  // ── Step 3: Margin check ──
  const projectedSpend = allocatedBudget;
  const marginResult = calculateDailyMargin(
    config.currentRevenue,
    projectedSpend,
    config.marginConfig
  );

  // If projected margin is too low, scale down allocations proportionally
  if (marginResult.dailyMargin < config.marginConfig.targetMarginMin && allocatedBudget > 0) {
    // Find the maximum spend that keeps margin at target
    const targetMargin = config.marginConfig.targetMarginMin;
    const grossProfit = config.currentRevenue * (1 - config.marginConfig.avgCogsRate);
    const maxSpend = grossProfit - (targetMargin * config.currentRevenue);

    if (maxSpend > 0 && maxSpend < allocatedBudget) {
      const scaleFactor = maxSpend / allocatedBudget;
      allocatedBudget = 0;
      for (const a of allocations) {
        if (a.recommendedBudget > 0) {
          a.recommendedBudget = Math.round(a.recommendedBudget * scaleFactor * 100) / 100;
          a.changePercent = a.currentBudget > 0
            ? Math.round(((a.recommendedBudget - a.currentBudget) / a.currentBudget) * 1000) / 10
            : 0;
          allocatedBudget += a.recommendedBudget;
        }
      }
    }
  }

  // ── Step 4: Calculate projected metrics ──
  const winnerBudget = allocations
    .filter((a) => a.status === 'WINNER')
    .reduce((sum, a) => sum + a.recommendedBudget, 0);

  const budgetUtilization = config.totalDailyBudget > 0
    ? (winnerBudget / config.totalDailyBudget) * 100
    : 0;

  const totalConversions = eligible.reduce((sum, c) => sum + c.conversions, 0);
  const projectedCpa = totalConversions > 0 ? allocatedBudget / totalConversions : null;
  const projectedRevenueFromAds = totalConversions * config.aov;
  const projectedRoas = allocatedBudget > 0 ? projectedRevenueFromAds / allocatedBudget : null;

  const finalMargin = calculateDailyMargin(
    config.currentRevenue,
    allocatedBudget,
    config.marginConfig
  );

  return {
    totalBudget: config.totalDailyBudget,
    allocations: allocations.sort((a, b) => b.recommendedBudget - a.recommendedBudget),
    projectedMargin: finalMargin.dailyMargin,
    projectedRoas,
    projectedCpa,
    budgetUtilization: Math.round(budgetUtilization * 10) / 10,
  };
}
