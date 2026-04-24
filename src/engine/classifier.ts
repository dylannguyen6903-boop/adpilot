/**
 * Campaign Classifier for AdPilot
 * 
 * Assigns a status (WINNER / PROMISING / WATCH / KILL / LEARNING) to each campaign
 * using a weighted composite score with 5 metrics:
 * - CPA Score (w=0.30)
 * - CTR Score (w=0.15)
 * - Conversion Score (w=0.25)
 * - Stability Score (w=0.15)
 * - Margin Score (w=0.15)
 */

import type { CampaignStatus } from '@/types/campaign';
import { coefficientOfVariation } from '@/lib/utils';
import { ltvAdjustedCPA } from './ltv';
import { calculateCampaignMargin } from './margin';

export interface ClassifierConfig {
  // LTV params
  returningRate: number;
  avgRepeatOrders: number;
  aov: number;
  targetMarginMin: number;
  targetMarginMax: number;
  avgCogsRate: number;

  // Thresholds
  thresholdWinner: number;       // default 0.7
  thresholdPromising: number;    // default 0.4
  thresholdWatch: number;        // default 0.2

  // Benchmarks
  targetCpa: number;             // $40
  benchmarkCtr: number;          // 2.0%
}

export interface CampaignInput {
  campaignId: string;
  campaignName: string;

  // Current metrics
  spend: number;
  conversions: number;
  cpa: number | null;
  ctr: number;

  // History for stability
  dailyCpaHistory: number[];      // Last 5 days of CPA values
  
  // Campaign age / state
  daysRunning: number;
  budgetChangedWithin24h: boolean;
}

export interface ClassificationResult {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  performanceScore: number;       // 0-1
  ltvAdjustedCpa: number | null;
  marginContribution: number | null;

  // Score breakdown
  scores: {
    cpa: number;
    ctr: number;
    conversion: number;
    stability: number;
    margin: number;
  };

  // Explanation
  reason: string;
}

const DEFAULT_CONFIG: ClassifierConfig = {
  returningRate: 0.22,
  avgRepeatOrders: 1.5,
  aov: 87,
  targetMarginMin: 0.17,
  targetMarginMax: 0.20,
  avgCogsRate: 0.32,
  thresholdWinner: 0.7,
  thresholdPromising: 0.4,
  thresholdWatch: 0.2,
  targetCpa: 40,
  benchmarkCtr: 2.0,
};

// Weights for composite score
const WEIGHTS = {
  cpa: 0.30,
  ctr: 0.15,
  conversion: 0.25,
  stability: 0.15,
  margin: 0.15,
};

/**
 * Classify a single campaign.
 */
export function classifyCampaign(
  campaign: CampaignInput,
  config: Partial<ClassifierConfig> = {}
): ClassificationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── LEARNING override ──
  if (campaign.daysRunning < 3 || campaign.budgetChangedWithin24h) {
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      status: 'LEARNING',
      performanceScore: 0,
      ltvAdjustedCpa: campaign.cpa
        ? ltvAdjustedCPA(campaign.cpa, cfg)
        : null,
      marginContribution: null,
      scores: { cpa: 0, ctr: 0, conversion: 0, stability: 0, margin: 0 },
      reason: campaign.daysRunning < 3
        ? `Campaign is only ${campaign.daysRunning} day(s) old — still in learning phase.`
        : 'Budget was changed within the last 24h — waiting to stabilize.',
    };
  }

  // ── Calculate component scores ──

  // 1. CPA Score — uses LTV-adjusted CPA
  const ltvAdjCpa = campaign.cpa
    ? ltvAdjustedCPA(campaign.cpa, cfg)
    : null;
  
  // Max allowable CPA based on LTV
  const maxAllowableCpa = cfg.aov * cfg.targetMarginMax * (1 + cfg.returningRate * cfg.avgRepeatOrders);
  
  const cpaScore = ltvAdjCpa !== null
    ? Math.max(0, 1 - (ltvAdjCpa / maxAllowableCpa))
    : 0;

  // 2. CTR Score
  const ctrScore = Math.min(1, campaign.ctr / cfg.benchmarkCtr);

  // 3. Conversion Score
  const expectedConversions = campaign.spend > 0 ? campaign.spend / cfg.targetCpa : 0;
  const conversionScore = expectedConversions > 0
    ? Math.min(2, campaign.conversions / expectedConversions)
    : 0;

  // 4. Stability Score (requires history)
  const cov = campaign.dailyCpaHistory.length >= 2
    ? coefficientOfVariation(campaign.dailyCpaHistory)
    : 0.5;  // assume moderate instability if no history
  const stabilityScore = Math.max(0, 1 - cov);

  // 5. Margin Score
  const marginResult = calculateCampaignMargin(
    campaign.campaignId,
    campaign.conversions,
    campaign.spend,
    cfg.aov,
    { targetMarginMin: cfg.targetMarginMin, targetMarginMax: cfg.targetMarginMax, avgCogsRate: cfg.avgCogsRate }
  );
  const marginScore = Math.max(0, Math.min(1,
    (marginResult.marginContribution - 0.15) / 0.05
  ));

  // ── Composite Score ──
  const performanceScore =
    WEIGHTS.cpa * cpaScore +
    WEIGHTS.ctr * ctrScore +
    WEIGHTS.conversion * conversionScore +
    WEIGHTS.stability * stabilityScore +
    WEIGHTS.margin * marginScore;

  // Clamp to 0-1
  const clampedScore = Math.max(0, Math.min(1, performanceScore));

  // ── Classify ──
  let status: CampaignStatus;
  let reason: string;

  // Force KILL: zero conversions after spending 2× target CPA
  if (campaign.conversions === 0 && campaign.spend >= cfg.targetCpa * 2) {
    status = 'KILL';
    reason = `$${campaign.spend.toFixed(0)} spent with 0 conversions (>${cfg.targetCpa * 2} threshold). Kill immediately.`;
  } else if (clampedScore >= cfg.thresholdWinner) {
    status = 'WINNER';
    reason = `Score ${clampedScore.toFixed(2)} ≥ ${cfg.thresholdWinner}. LTV-adj CPA: $${ltvAdjCpa?.toFixed(2) || 'N/A'}. Ready to scale.`;
  } else if (clampedScore >= cfg.thresholdPromising) {
    status = 'PROMISING';
    reason = `Score ${clampedScore.toFixed(2)} is promising. Monitor for 2-3 more days before scaling.`;
  } else if (clampedScore >= cfg.thresholdWatch) {
    status = 'WATCH';
    reason = `Score ${clampedScore.toFixed(2)} is borderline. Don't increase budget — wait for more data.`;
  } else {
    status = 'KILL';
    reason = `Score ${clampedScore.toFixed(2)} < ${cfg.thresholdWatch}. CPA too high or no conversions.`;
  }

  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    status,
    performanceScore: Math.round(clampedScore * 100) / 100,
    ltvAdjustedCpa: ltvAdjCpa,
    marginContribution: marginResult.marginContribution,
    scores: {
      cpa: Math.round(cpaScore * 100) / 100,
      ctr: Math.round(ctrScore * 100) / 100,
      conversion: Math.round(conversionScore * 100) / 100,
      stability: Math.round(stabilityScore * 100) / 100,
      margin: Math.round(marginScore * 100) / 100,
    },
    reason,
  };
}

/**
 * Classify multiple campaigns at once.
 * Also applies margin-pressure override: if daily margin is below target,
 * downgrade all non-WINNER campaigns by one level.
 */
export function classifyAllCampaigns(
  campaigns: CampaignInput[],
  dailyMargin: number | null,
  config: Partial<ClassifierConfig> = {}
): ClassificationResult[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results = campaigns.map((c) => classifyCampaign(c, cfg));

  // Margin pressure override
  if (dailyMargin !== null && dailyMargin < cfg.targetMarginMin) {
    for (const result of results) {
      if (result.status === 'PROMISING') {
        result.status = 'WATCH';
        result.reason += ' [DOWNGRADED: daily margin below target]';
      } else if (result.status === 'WATCH') {
        result.status = 'KILL';
        result.reason += ' [DOWNGRADED: daily margin below target]';
      }
    }
  }

  return results;
}
