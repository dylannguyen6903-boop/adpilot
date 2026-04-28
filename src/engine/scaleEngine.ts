/**
 * Scale Engine for AdPilot V3.0
 *
 * Implements scaling recommendations based on real-world best practices:
 * - Budget ≥ $500/day: +5% every 2 days (from $30M agency research)
 * - Budget < $500/day: +20% to reach critical mass faster
 * - Rollback if CPA increases > 20% post-scale
 * - Budget reallocation from losers to winners
 * - Consolidation principle: no campaign duplication (vertical scaling only)
 */

import type { CampaignEvaluation, EvalCampaignData } from './evaluator';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface ScaleRecommendation {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  recommendedBudget: number;
  changePercent: number;
  method: 'VERTICAL';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning: string;
  waitDays: number;
}

export interface BudgetReallocation {
  from: { campaignId: string; campaignName: string; amount: number };
  to: { campaignId: string; campaignName: string; amount: number };
  reasoning: string;
}

// ─────────────────────────────────────────
// Scale Recommendations
// ─────────────────────────────────────────

/**
 * Generate a scale recommendation for a SCALING-phase campaign.
 * Uses the 5%/20% rule from industry research:
 * - ≥ $500/day budget: conservative +5% every 2 days
 * - < $500/day budget: +20% to reach critical mass
 */
export function getScaleRecommendation(
  evaluation: CampaignEvaluation,
  data: EvalCampaignData
): ScaleRecommendation | null {
  if (evaluation.action !== 'SCALE' || data.dailyBudget <= 0) {
    return null;
  }

  let changePercent: number;
  let reasoning: string;

  if (data.dailyBudget >= 500) {
    // Conservative scaling for mature budgets
    changePercent = 5;
    reasoning = `Budget $${data.dailyBudget}/day (≥$500). Conservative +5% to avoid learning phase reset. Scale every 2 days.`;
  } else if (data.dailyBudget >= 100) {
    // Moderate scaling for mid-range budgets
    changePercent = 15;
    reasoning = `Budget $${data.dailyBudget}/day. Moderate +15% — building toward $500/day critical mass.`;
  } else {
    // Aggressive scaling for small budgets to reach critical mass
    changePercent = 20;
    reasoning = `Budget $${data.dailyBudget}/day (<$100). +20% to build data volume faster. Target: $500/day for optimal learning.`;
  }

  const recommendedBudget = Math.round(data.dailyBudget * (1 + changePercent / 100) * 100) / 100;

  // Assess risk
  let risk: ScaleRecommendation['risk'];
  if (data.dailyBudget >= 500) {
    if (data.consecutiveProfitDays >= 7) risk = 'LOW';
    else if (data.consecutiveProfitDays >= 5) risk = 'MEDIUM';
    else risk = 'HIGH';
  } else if (data.dailyBudget >= 100) {
    if (data.consecutiveProfitDays >= 5) risk = 'LOW';
    else if (data.consecutiveProfitDays >= 3) risk = 'MEDIUM';
    else risk = 'HIGH';
  } else if (data.consecutiveProfitDays >= 3 && data.conversions7d >= 3) {
    risk = 'LOW';
  } else if (data.consecutiveProfitDays >= 2 && data.conversions7d >= 2) {
    risk = 'MEDIUM';
  } else {
    risk = 'HIGH';
  }

  return {
    campaignId: evaluation.campaignId,
    campaignName: evaluation.campaignName,
    currentBudget: data.dailyBudget,
    recommendedBudget,
    changePercent,
    method: 'VERTICAL',
    risk,
    reasoning,
    waitDays: 2,
  };
}

// ─────────────────────────────────────────
// Rollback Check
// ─────────────────────────────────────────

/**
 * Determine if a budget scale should be rolled back.
 * Triggers when post-scale CPA increases by more than 20%.
 */
export function shouldRollback(
  preScaleCPA: number,
  postScaleCPA: number
): boolean {
  if (preScaleCPA <= 0) return false;
  return postScaleCPA > preScaleCPA * 1.20;
}

// ─────────────────────────────────────────
// Budget Reallocation
// ─────────────────────────────────────────

/**
 * Generate budget reallocation suggestions:
 * Move money from KILL/FATIGUED campaigns to SCALING/PERFORMING campaigns.
 */
export function generateBudgetReallocation(
  evaluations: CampaignEvaluation[],
  data: EvalCampaignData[]
): BudgetReallocation[] {
  const reallocations: BudgetReallocation[] = [];

  // Find "source" campaigns (being killed or fatigued)
  const sources = evaluations
    .filter(e => e.action === 'KILL' || e.action === 'REFRESH')
    .map(e => {
      const d = data.find(c => c.campaignId === e.campaignId);
      return { eval: e, data: d };
    })
    .filter(s => s.data && s.data.dailyBudget > 0);

  // Find "destination" campaigns (performing well, can absorb more)
  const destinations = evaluations
    .filter(e => e.action === 'SCALE' || (e.action === 'KEEP' && e.lifecycle === 'PERFORMING'))
    .sort((a, b) => (b.funnelHealth - a.funnelHealth))
    .map(e => {
      const d = data.find(c => c.campaignId === e.campaignId);
      return { eval: e, data: d };
    })
    .filter(d => d.data);

  if (sources.length === 0 || destinations.length === 0) return [];

  // Simple allocation: distribute freed budget evenly across top destinations
  const totalFreed = sources.reduce((sum, s) => sum + (s.data?.dailyBudget || 0), 0);
  const topDests = destinations.slice(0, 3); // Max 3 destination campaigns
  const perDest = Math.round(totalFreed / topDests.length * 100) / 100;

  if (perDest < 1) return []; // Not worth reallocating tiny amounts

  for (const source of sources) {
    if (!source.data) continue;
    for (const dest of topDests) {
      if (!dest.data) continue;
      const amount = Math.round(source.data.dailyBudget / topDests.length * 100) / 100;
      if (amount < 1) continue;

      reallocations.push({
        from: {
          campaignId: source.eval.campaignId,
          campaignName: source.eval.campaignName,
          amount,
        },
        to: {
          campaignId: dest.eval.campaignId,
          campaignName: dest.eval.campaignName,
          amount,
        },
        reasoning: `Reallocate $${amount.toFixed(0)}/day from ${source.eval.action === 'KILL' ? 'killed' : 'fatigued'} campaign to ${dest.eval.lifecycle} performer (health ${dest.eval.funnelHealth}/100).`,
      });
    }
  }

  return reallocations;
}
