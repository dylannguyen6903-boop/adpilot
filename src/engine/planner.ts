/**
 * Action Plan Generator for AdPilot
 * 
 * Combines outputs from Classifier + Scaler + Allocator + Margin Calculator
 * to produce a daily action plan: a prioritized to-do list of SCALE / KILL / WATCH actions.
 */

import type { ActionItem, ActionType } from '@/types/plan';
import type { ClassificationResult } from './classifier';
import type { ScalingRecommendation } from './scaler';
import type { DailyMarginResult } from './margin';

export interface PlannerInput {
  classifications: ClassificationResult[];
  scalingRecommendations: ScalingRecommendation[];
  marginResult: DailyMarginResult;
  currentBudgets: Map<string, number>;  // campaignId → current daily budget
}

export interface GeneratedPlan {
  date: string;
  actions: ActionItem[];
  scaleCount: number;
  killCount: number;
  watchCount: number;
  projectedMargin: number | null;
  budgetSaved: number;
  summary: string;
}

/**
 * Generate today's action plan from classifier + scaler outputs.
 */
export function generateActionPlan(input: PlannerInput): GeneratedPlan {
  const today = new Date().toISOString().split('T')[0];
  const actions: ActionItem[] = [];
  let actionId = 0;
  let budgetSaved = 0;

  // ── KILL Actions ──
  const killCampaigns = input.classifications.filter((c) => c.status === 'KILL');
  for (const campaign of killCampaigns) {
    const currentBudget = input.currentBudgets.get(campaign.campaignId) || 0;
    budgetSaved += currentBudget;

    actions.push({
      id: `action-${++actionId}`,
      type: 'KILL' as ActionType,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      description: `Kill campaign — stop spending $${currentBudget.toFixed(0)}/day`,
      reason: campaign.reason,
      oldBudget: currentBudget,
      newBudget: 0,
      currentCpa: null,
      currentLtvCpa: campaign.ltvAdjustedCpa,
      isCompleted: false,
      completedAt: null,
      aiReasoning: null,
      aiPrediction: null,
      aiConfidence: null,
    });
  }

  // ── SCALE Actions ──
  const scaleRecommendations = input.scalingRecommendations.filter(
    (r) => r.action === 'SCALE_UP' || r.action === 'HORIZONTAL'
  );

  for (const rec of scaleRecommendations) {
    const classification = input.classifications.find(
      (c) => c.campaignId === rec.campaignId
    );

    if (rec.action === 'SCALE_UP') {
      actions.push({
        id: `action-${++actionId}`,
        type: 'SCALE' as ActionType,
        campaignId: rec.campaignId,
        campaignName: rec.campaignName,
        description: `Increase budget from $${rec.currentBudget}/day → $${rec.suggestedBudget}/day (+${rec.changePercent}%)`,
        reason: rec.reason,
        oldBudget: rec.currentBudget,
        newBudget: rec.suggestedBudget,
        currentCpa: null,
        currentLtvCpa: classification?.ltvAdjustedCpa || null,
        isCompleted: false,
        completedAt: null,
        aiReasoning: null,
        aiPrediction: null,
        aiConfidence: null,
      });
    } else if (rec.action === 'HORIZONTAL') {
      actions.push({
        id: `action-${++actionId}`,
        type: 'LAUNCH' as ActionType,
        campaignId: rec.campaignId,
        campaignName: rec.campaignName,
        description: `Duplicate campaign and test new audience — ${rec.changePercent} consecutive wins`,
        reason: rec.reason,
        oldBudget: rec.currentBudget,
        newBudget: rec.currentBudget,
        currentCpa: null,
        currentLtvCpa: classification?.ltvAdjustedCpa || null,
        isCompleted: false,
        completedAt: null,
        aiReasoning: null,
        aiPrediction: null,
        aiConfidence: null,
      });
    }
  }

  // ── REVERT Actions ──
  const revertRecommendations = input.scalingRecommendations.filter(
    (r) => r.action === 'REVERT'
  );

  for (const rec of revertRecommendations) {
    actions.push({
      id: `action-${++actionId}`,
      type: 'REVERT' as ActionType,
      campaignId: rec.campaignId,
      campaignName: rec.campaignName,
      description: `Revert budget to $${rec.suggestedBudget}/day (CPA spiked after last scale)`,
      reason: rec.reason,
      oldBudget: rec.currentBudget,
      newBudget: rec.suggestedBudget,
      currentCpa: null,
      currentLtvCpa: null,
      isCompleted: false,
      completedAt: null,
      aiReasoning: null,
      aiPrediction: null,
      aiConfidence: null,
    });
  }

  // ── WATCH Actions ──
  const watchCampaigns = input.classifications.filter((c) => c.status === 'WATCH');
  for (const campaign of watchCampaigns) {
    const currentBudget = input.currentBudgets.get(campaign.campaignId) || 0;

    actions.push({
      id: `action-${++actionId}`,
      type: 'WATCH' as ActionType,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      description: `Keep monitoring — do NOT increase budget ($${currentBudget.toFixed(0)}/day)`,
      reason: campaign.reason,
      oldBudget: currentBudget,
      newBudget: currentBudget,
      currentCpa: null,
      currentLtvCpa: campaign.ltvAdjustedCpa,
      isCompleted: false,
      completedAt: null,
      aiReasoning: null,
      aiPrediction: null,
      aiConfidence: null,
    });
  }

  // ── Sort: KILL first (save money), then SCALE, then REVERT, then WATCH ──
  const typePriority: Record<ActionType, number> = {
    KILL: 0,
    REVERT: 1,
    SCALE: 2,
    LAUNCH: 3,
    WATCH: 4,
  };
  actions.sort((a, b) => typePriority[a.type] - typePriority[b.type]);

  // ── Summary ──
  const scaleCount = actions.filter((a) => a.type === 'SCALE' || a.type === 'LAUNCH').length;
  const killCount = actions.filter((a) => a.type === 'KILL').length;
  const watchCount = actions.filter((a) => a.type === 'WATCH').length;

  const summary = buildSummary(scaleCount, killCount, watchCount, budgetSaved, input.marginResult);

  return {
    date: today,
    actions,
    scaleCount,
    killCount,
    watchCount,
    projectedMargin: input.marginResult.dailyMargin,
    budgetSaved: Math.round(budgetSaved * 100) / 100,
    summary,
  };
}

function buildSummary(
  scaleCount: number,
  killCount: number,
  watchCount: number,
  budgetSaved: number,
  margin: DailyMarginResult
): string {
  const parts: string[] = [];

  if (killCount > 0) {
    parts.push(`🔴 Kill ${killCount} campaign${killCount > 1 ? 's' : ''} → save $${budgetSaved.toFixed(0)}/day`);
  }
  if (scaleCount > 0) {
    parts.push(`🟢 Scale ${scaleCount} winner${scaleCount > 1 ? 's' : ''}`);
  }
  if (watchCount > 0) {
    parts.push(`🟠 Monitor ${watchCount} campaign${watchCount > 1 ? 's' : ''}`);
  }

  parts.push(`📊 Daily margin: ${margin.marginPercent} (${margin.marginStatus})`);

  return parts.join(' • ');
}
