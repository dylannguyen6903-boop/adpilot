/**
 * Scaling Protocol Engine for AdPilot
 * 
 * Rules:
 * 1. Only scale WINNER campaigns
 * 2. Max 20% budget increase every 48 hours
 * 3. After scaling → campaign enters LEARNING for 24h
 * 4. If CPA spikes >30% after scale → suggest revert
 * 5. If daily margin < 17% → block all scaling
 * 6. After 3 consecutive successful scales → suggest horizontal scaling
 */

import type { CampaignStatus } from '@/types/campaign';
import type { ScalingEvent } from '@/types/campaign';

export interface ScalingInput {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  currentBudget: number;
  currentCpa: number | null;
  daysRunning: number;

  // Scaling history
  recentScalingEvents: ScalingEvent[];
  lastScaleTimestamp: string | null;

  // Context
  dailyMargin: number | null;
  marginFloor: number;    // 0.17
}

export interface ScalingRecommendation {
  campaignId: string;
  campaignName: string;
  action: 'SCALE_UP' | 'HOLD' | 'REVERT' | 'HORIZONTAL' | 'BLOCKED';
  currentBudget: number;
  suggestedBudget: number | null;
  changePercent: number;
  reason: string;
  cooldownRemaining: number | null;  // hours until next scale allowed
}

const MAX_SCALE_PERCENT = 0.20;       // 20%
const SCALE_COOLDOWN_HOURS = 48;
const LEARNING_HOURS = 24;
const CPA_SPIKE_THRESHOLD = 0.30;     // 30% increase = spike
const CONSECUTIVE_SUCCESS_FOR_HORIZONTAL = 3;

/**
 * Evaluate whether a campaign should be scaled and how.
 */
export function evaluateScaling(input: ScalingInput): ScalingRecommendation {
  const base: Pick<ScalingRecommendation, 'campaignId' | 'campaignName' | 'currentBudget'> = {
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    currentBudget: input.currentBudget,
  };

  // ── BLOCK: Daily margin too low ──
  if (input.dailyMargin !== null && input.dailyMargin < input.marginFloor) {
    return {
      ...base,
      action: 'BLOCKED',
      suggestedBudget: null,
      changePercent: 0,
      reason: `Scaling blocked: daily margin ${(input.dailyMargin * 100).toFixed(1)}% is below ${(input.marginFloor * 100).toFixed(0)}% floor.`,
      cooldownRemaining: null,
    };
  }

  // ── HOLD: Not a WINNER ──
  if (input.status !== 'WINNER') {
    return {
      ...base,
      action: 'HOLD',
      suggestedBudget: null,
      changePercent: 0,
      reason: `Only WINNER campaigns can be scaled. Current status: ${input.status}.`,
      cooldownRemaining: null,
    };
  }

  // ── CHECK: Cooldown period ──
  if (input.lastScaleTimestamp) {
    const lastScale = new Date(input.lastScaleTimestamp).getTime();
    const now = Date.now();
    const hoursSinceLastScale = (now - lastScale) / (1000 * 60 * 60);

    if (hoursSinceLastScale < SCALE_COOLDOWN_HOURS) {
      const remaining = Math.ceil(SCALE_COOLDOWN_HOURS - hoursSinceLastScale);
      return {
        ...base,
        action: 'HOLD',
        suggestedBudget: null,
        changePercent: 0,
        reason: `Scale cooldown: ${remaining}h remaining (last scaled ${Math.floor(hoursSinceLastScale)}h ago).`,
        cooldownRemaining: remaining,
      };
    }
  }

  // ── CHECK: CPA spike after last scale → suggest revert ──
  const lastScaleEvent = input.recentScalingEvents.find(
    (e) => e.action === 'SCALE_UP' && e.cpaBefore !== null && e.cpaAfter !== null
  );

  if (lastScaleEvent && lastScaleEvent.cpaBefore && lastScaleEvent.cpaAfter) {
    const cpaIncrease = (lastScaleEvent.cpaAfter - lastScaleEvent.cpaBefore) / lastScaleEvent.cpaBefore;
    if (cpaIncrease > CPA_SPIKE_THRESHOLD) {
      return {
        ...base,
        action: 'REVERT',
        suggestedBudget: lastScaleEvent.oldBudget,
        changePercent: lastScaleEvent.oldBudget
          ? ((lastScaleEvent.oldBudget - input.currentBudget) / input.currentBudget) * 100
          : 0,
        reason: `CPA spiked ${(cpaIncrease * 100).toFixed(0)}% after last scale ($${lastScaleEvent.cpaBefore.toFixed(2)} → $${lastScaleEvent.cpaAfter.toFixed(2)}). Revert to $${lastScaleEvent.oldBudget}/day.`,
        cooldownRemaining: null,
      };
    }
  }

  // ── CHECK: Horizontal scaling trigger ──
  const consecutiveSuccesses = countConsecutiveSuccessfulScales(input.recentScalingEvents);
  if (consecutiveSuccesses >= CONSECUTIVE_SUCCESS_FOR_HORIZONTAL) {
    return {
      ...base,
      action: 'HORIZONTAL',
      suggestedBudget: input.currentBudget,  // keep current
      changePercent: 0,
      reason: `${consecutiveSuccesses} consecutive successful scales. Consider duplicating this campaign and testing new audiences.`,
      cooldownRemaining: null,
    };
  }

  // ── SCALE UP ──
  const newBudget = Math.round(input.currentBudget * (1 + MAX_SCALE_PERCENT) * 100) / 100;
  const changePercent = MAX_SCALE_PERCENT * 100;

  return {
    ...base,
    action: 'SCALE_UP',
    suggestedBudget: newBudget,
    changePercent,
    reason: `WINNER campaign eligible for ${changePercent}% scale: $${input.currentBudget}/day → $${newBudget}/day.`,
    cooldownRemaining: null,
  };
}

/**
 * Count how many consecutive recent scales were successful.
 */
function countConsecutiveSuccessfulScales(events: ScalingEvent[]): number {
  let count = 0;
  // Sort by most recent first
  const sorted = [...events]
    .filter((e) => e.action === 'SCALE_UP')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (const event of sorted) {
    if (event.success === true) {
      count++;
    } else {
      break;  // Streak broken
    }
  }

  return count;
}

/**
 * Check if a campaign is still in the learning/cooldown period after a scale.
 */
export function isInLearningAfterScale(lastScaleTimestamp: string | null): boolean {
  if (!lastScaleTimestamp) return false;
  const lastScale = new Date(lastScaleTimestamp).getTime();
  const hoursSince = (Date.now() - lastScale) / (1000 * 60 * 60);
  return hoursSince < LEARNING_HOURS;
}
