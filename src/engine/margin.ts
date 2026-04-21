/**
 * Margin Calculator for AdPilot
 * 
 * Calculates daily profitability metrics:
 * - Daily margin (revenue - COGS - ad spend) / revenue
 * - Per-campaign margin contribution
 * - Margin status classification (CRITICAL / ON_TARGET / HEALTHY)
 */

import type { MarginStatus } from '@/types/financial';

export interface MarginConfig {
  targetMarginMin: number;    // 0.17
  targetMarginMax: number;    // 0.20
  avgCogsRate: number;        // 0.80
}

export interface DailyMarginResult {
  shopifyRevenue: number;
  totalAdSpend: number;
  estimatedCogs: number;
  grossProfit: number;
  netProfit: number;
  dailyMargin: number;         // as decimal (0.185 = 18.5%)
  marginStatus: MarginStatus;
  marginPercent: string;       // formatted "18.5%"
  message: string;
  hasRoomToScale: boolean;
}

export interface CampaignMarginResult {
  campaignId: string;
  campaignRevenue: number;     // conversions × AOV
  campaignCogs: number;
  campaignSpend: number;
  campaignProfit: number;
  marginContribution: number;  // as decimal
  isProfitable: boolean;
}

const DEFAULT_CONFIG: MarginConfig = {
  targetMarginMin: 0.17,
  targetMarginMax: 0.20,
  avgCogsRate: 0.80,
};

/**
 * Calculate daily margin from total revenue and total ad spend.
 */
export function calculateDailyMargin(
  shopifyRevenue: number,
  totalAdSpend: number,
  config: MarginConfig = DEFAULT_CONFIG
): DailyMarginResult {
  const estimatedCogs = shopifyRevenue * config.avgCogsRate;
  const grossProfit = shopifyRevenue - estimatedCogs;
  const netProfit = grossProfit - totalAdSpend;

  // Avoid division by zero
  const dailyMargin = shopifyRevenue > 0 ? netProfit / shopifyRevenue : 0;

  // Classify margin status
  let marginStatus: MarginStatus;
  let message: string;

  if (dailyMargin < config.targetMarginMin) {
    marginStatus = 'CRITICAL';
    message = `Daily margin ${(dailyMargin * 100).toFixed(1)}% is BELOW the ${(config.targetMarginMin * 100).toFixed(0)}% floor. Consider killing underperforming campaigns immediately.`;
  } else if (dailyMargin <= config.targetMarginMax) {
    marginStatus = 'ON_TARGET';
    message = `Daily margin ${(dailyMargin * 100).toFixed(1)}% is on target (${(config.targetMarginMin * 100).toFixed(0)}-${(config.targetMarginMax * 100).toFixed(0)}%).`;
  } else {
    marginStatus = 'HEALTHY';
    message = `Daily margin ${(dailyMargin * 100).toFixed(1)}% is above target. You have room to scale winners.`;
  }

  return {
    shopifyRevenue,
    totalAdSpend,
    estimatedCogs,
    grossProfit,
    netProfit,
    dailyMargin,
    marginStatus,
    marginPercent: `${(dailyMargin * 100).toFixed(1)}%`,
    message,
    hasRoomToScale: dailyMargin > config.targetMarginMin,
  };
}

/**
 * Calculate per-campaign margin contribution.
 */
export function calculateCampaignMargin(
  campaignId: string,
  conversions: number,
  spend: number,
  aov: number,
  config: MarginConfig = DEFAULT_CONFIG
): CampaignMarginResult {
  const campaignRevenue = conversions * aov;
  const campaignCogs = campaignRevenue * config.avgCogsRate;
  const campaignProfit = campaignRevenue - campaignCogs - spend;
  const marginContribution = campaignRevenue > 0
    ? campaignProfit / campaignRevenue
    : spend > 0 ? -1 : 0;  // If spending but no revenue, margin is deeply negative

  return {
    campaignId,
    campaignRevenue,
    campaignCogs,
    campaignSpend: spend,
    campaignProfit,
    marginContribution,
    isProfitable: campaignProfit > 0,
  };
}

/**
 * Project what the daily margin would be if ad spend changed by a given amount.
 * Useful for the "what-if" simulator.
 */
export function projectMarginAfterSpendChange(
  currentRevenue: number,
  currentAdSpend: number,
  spendChange: number,          // positive = more spend, negative = less
  expectedRevenuePerDollar: number,  // rough multiplier (e.g., ROAS)
  config: MarginConfig = DEFAULT_CONFIG
): DailyMarginResult {
  const newAdSpend = currentAdSpend + spendChange;
  const additionalRevenue = spendChange > 0 ? spendChange * expectedRevenuePerDollar : 0;
  const newRevenue = currentRevenue + additionalRevenue;

  return calculateDailyMargin(newRevenue, newAdSpend, config);
}
