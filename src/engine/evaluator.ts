/**
 * Smart Campaign Evaluation Engine for AdPilot V3.0
 *
 * Multi-signal, lifecycle-aware campaign evaluation using:
 * - Campaign maturity phases (LEARNING → EVALUATING → PERFORMING → SCALING → FATIGUED)
 * - Funnel health score (0-100, 8 dimensions)
 * - Profit-adjusted CPA (AOV × margin - CPA = profit per order)
 * - Prospecting vs Retargeting classification
 * - Metric combo diagnosis (6 patterns)
 *
 * Research basis: Meta Andromeda engine, $30M+ agency practices,
 * industry-standard scaling/kill frameworks.
 */

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type LifecyclePhase = 'LEARNING' | 'EVALUATING' | 'PERFORMING' | 'SCALING' | 'FATIGUED';
export type CampType = 'PROSPECTING' | 'RETARGETING' | 'MIXED';
export type EvalAction = 'NO_ACTION' | 'WATCH' | 'KEEP' | 'SCALE' | 'REFRESH' | 'KILL';

export interface EvalCampaignData {
  campaignId: string;
  campaignName: string;
  fbStatus: string;

  // Today's metrics
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  addToCart: number;
  initiateCheckout: number;
  cpa: number | null;
  ctr: number;
  cpm: number;
  cpc: number;
  roas: number | null;
  frequency: number;
  dailyBudget: number;
  revenueFb: number;

  // 7-day aggregated (primary evaluation window)
  spend7d: number;
  conversions7d: number;
  atc7d: number;
  ic7d: number;
  avgCPA7d: number | null;
  avgCTR7d: number;
  avgFrequency7d: number;
  avgAOV7d: number | null;
  profitPerOrder7d: number | null;

  // Trends (% change vs 3-day-ago)
  ctrTrend: number;
  cpaTrend: number;
  cpmTrend: number;

  // Stability
  daysRunning: number;
  daysWithPurchases: number;
  consecutiveProfitDays: number;
}

export interface EvalConfig {
  targetCpa: number;
  aov: number;
  avgCogsRate: number;
  breakevenCpa: number;   // aov × (1 - cogsRate)
}

export interface CampaignEvaluation {
  campaignId: string;
  campaignName: string;
  lifecycle: LifecyclePhase;
  campType: CampType;
  action: EvalAction;
  funnelHealth: number;
  profitPerOrder: number | null;
  diagnosis: string;
  reasoning: string;
  confidence: number;
}

// ─────────────────────────────────────────
// Camp Type Classification
// ─────────────────────────────────────────

/**
 * Classify campaign type based on average frequency.
 * Low freq = prospecting (reaching new people).
 * High freq = retargeting (showing to same people).
 */
export function classifyCampType(avgFrequency: number): CampType {
  if (avgFrequency <= 0) return 'MIXED';
  if (avgFrequency < 1.20) return 'PROSPECTING';
  if (avgFrequency >= 1.35) return 'RETARGETING';
  return 'MIXED';
}

// ─────────────────────────────────────────
// Lifecycle Phase Detection
// ─────────────────────────────────────────

/**
 * Determine campaign lifecycle phase based on spend, stability, and fatigue signals.
 */
export function getLifecyclePhase(data: EvalCampaignData, config: EvalConfig): LifecyclePhase {
  const halfCpa = config.targetCpa * 0.5; // ~$20

  // LEARNING: too early to judge
  if (data.spend7d < halfCpa || data.daysRunning < 2) {
    return 'LEARNING';
  }

  // FATIGUED: clear decay signals (check before SCALING/PERFORMING)
  if (
    data.daysRunning >= 7 &&
    data.ctrTrend < -15 &&
    (data.avgFrequency7d > 3.0 || data.frequency > 3.0)
  ) {
    return 'FATIGUED';
  }

  // SCALING: proven profitable + stable
  if (
    data.consecutiveProfitDays >= 5 &&
    data.avgFrequency7d < 2.5 &&
    data.conversions7d > 0 &&
    data.avgCPA7d !== null &&
    data.avgCPA7d <= config.targetCpa * 1.5
  ) {
    return 'SCALING';
  }

  // PERFORMING: has purchases and generally profitable
  if (
    data.conversions7d > 0 &&
    data.profitPerOrder7d !== null &&
    data.profitPerOrder7d > 0
  ) {
    return 'PERFORMING';
  }

  // EVALUATING: has some spend but not yet proven
  return 'EVALUATING';
}

// ─────────────────────────────────────────
// Funnel Health Score (0-100)
// ─────────────────────────────────────────

function scoreCTR(ctr: number): number {
  if (ctr >= 2.0) return 100;
  if (ctr >= 1.5) return 80;
  if (ctr >= 1.0) return 60;
  if (ctr >= 0.5) return 30;
  return 10;
}

function scoreATCRate(atc: number, clicks: number): number {
  if (clicks <= 0 || atc <= 0) return 0;
  const rate = (atc / clicks) * 100;
  if (rate >= 5) return 100;
  if (rate >= 3) return 70;
  if (rate >= 1) return 40;
  return 15;
}

function scoreICRate(ic: number, atc: number): number {
  if (atc <= 0 || ic <= 0) return 0;
  const rate = (ic / atc) * 100;
  if (rate >= 30) return 100;
  if (rate >= 20) return 70;
  if (rate >= 10) return 40;
  return 15;
}

function scoreProfitEfficiency(profitPerOrder: number | null): number {
  if (profitPerOrder === null) return -1; // signal to redistribute weight
  if (profitPerOrder >= 25) return 100;
  if (profitPerOrder >= 15) return 70;
  if (profitPerOrder >= 5) return 40;
  if (profitPerOrder > 0) return 20;
  return 10;
}

function scoreCPM(cpm: number): number {
  if (cpm <= 0) return 50;
  if (cpm < 15) return 100;
  if (cpm < 25) return 70;
  if (cpm < 40) return 40;
  return 10;
}

function scoreFrequencyHealth(frequency: number, campType: CampType): number {
  if (frequency <= 0) return 50;
  if (campType === 'PROSPECTING') {
    if (frequency < 1.2) return 100;
    if (frequency < 1.5) return 60;
    if (frequency < 2.0) return 30;
    return 0;
  }
  // Retargeting / Mixed — higher freq is expected
  if (frequency < 2.5) return 100;
  if (frequency < 3.5) return 60;
  if (frequency < 5.0) return 30;
  return 0;
}

function scoreTrendMomentum(ctrTrend: number, cpaTrend: number): number {
  let score = 0;
  // CTR improving is good
  if (ctrTrend > 5) score += 35;
  else if (ctrTrend >= -5) score += 20;
  else score += 0;

  // CPA declining is good (negative trend = better)
  if (cpaTrend < -5) score += 35;
  else if (cpaTrend <= 5) score += 20;
  else score += 0;

  // Normalize out of 100 (max possible = 70, scale to 100)
  return Math.min(100, Math.round(score * 100 / 70));
}

function scorePurchaseConsistency(daysWithPurchases: number): number {
  if (daysWithPurchases >= 7) return 100;
  if (daysWithPurchases >= 5) return 70;
  if (daysWithPurchases >= 3) return 40;
  if (daysWithPurchases >= 1) return 20;
  return 0;
}

/**
 * Calculate composite Funnel Health Score (0-100).
 * When no purchase data exists, CPA/consistency weights are redistributed.
 */
export function calculateFunnelHealth(
  data: EvalCampaignData,
  campType: CampType,
  config: EvalConfig
): number {
  const ctr = scoreCTR(data.avgCTR7d || data.ctr);
  const atcRate = scoreATCRate(data.atc7d || data.addToCart, data.clicks);
  const icRate = scoreICRate(data.ic7d || data.initiateCheckout, data.atc7d || data.addToCart);
  const profit = scoreProfitEfficiency(data.profitPerOrder7d);
  const cpm = scoreCPM(data.cpm);
  const freq = scoreFrequencyHealth(data.avgFrequency7d || data.frequency, campType);
  const trend = scoreTrendMomentum(data.ctrTrend, data.cpaTrend);
  const consistency = scorePurchaseConsistency(data.daysWithPurchases);

  // If no purchase data (profit = -1), redistribute CPA + consistency weights
  if (profit === -1) {
    // No purchase data: weights redistributed to top-of-funnel signals
    const total = (ctr * 0.25) + (atcRate * 0.30) + (icRate * 0.20) +
                  (cpm * 0.05) + (freq * 0.10) + (trend * 0.10);
    return Math.round(total);
  }

  // Full evaluation with purchase data
  const total = (ctr * 0.15) + (atcRate * 0.20) + (icRate * 0.15) +
                (profit * 0.20) + (cpm * 0.05) + (freq * 0.10) +
                (trend * 0.10) + (consistency * 0.05);
  return Math.round(total);
}

// ─────────────────────────────────────────
// Profit Per Order
// ─────────────────────────────────────────

export function calculateProfitPerOrder(aov: number, cogsRate: number, cpa: number): number {
  return aov * (1 - cogsRate) - cpa;
}

// ─────────────────────────────────────────
// Funnel Combo Diagnosis
// ─────────────────────────────────────────

/**
 * Diagnose the metric combo pattern to identify WHERE the problem is.
 * Returns a human-readable diagnosis string.
 */
export function diagnoseFunnelCombo(data: EvalCampaignData): string {
  const ctr = data.avgCTR7d || data.ctr;
  const hasATC = (data.atc7d || data.addToCart) > 0;
  const hasIC = (data.ic7d || data.initiateCheckout) > 0;
  const hasPurchase = (data.conversions7d || data.conversions) > 0;
  const highCTR = ctr >= 1.0;
  const lowCTR = ctr < 0.8;

  // Pattern 1: High CTR + No ATC → Landing page / product issue
  if (highCTR && !hasATC && !hasPurchase) {
    return 'High CTR but no Add to Cart → Creative OK, landing page or pricing issue';
  }

  // Pattern 2: Low CTR + Has purchase → Website converts, ad boring
  if (lowCTR && hasPurchase) {
    return 'Low CTR but converts → Website is strong, ad needs better hooks';
  }

  // Pattern 3: High CTR + ATC + No purchase → Checkout friction
  if (highCTR && hasATC && !hasPurchase) {
    if (hasIC) {
      return 'Full funnel engagement but no purchase → Checkout/payment friction';
    }
    return 'Clicks + Add to Cart but no checkout → Pricing or shipping concern';
  }

  // Pattern 4: Low everything → Creative + targeting miss
  if (lowCTR && !hasATC && !hasPurchase) {
    return 'Low engagement across all metrics → Creative or targeting not resonating';
  }

  // Pattern 5: Good funnel, profitable
  if (highCTR && hasPurchase) {
    const profitPerOrder = data.profitPerOrder7d;
    if (profitPerOrder !== null && profitPerOrder > 15) {
      return 'Strong funnel performance → Scale candidate';
    }
    if (profitPerOrder !== null && profitPerOrder > 0) {
      return 'Converting but thin margins → Monitor CPA closely';
    }
    if (profitPerOrder !== null && profitPerOrder <= 0) {
      return 'Converting but unprofitable → CPA exceeds margin';
    }
    return 'Healthy funnel with active conversions';
  }

  // Default
  if (hasPurchase) return 'Active conversions — monitoring performance';
  if (hasATC) return 'Mid-funnel engagement (ATC) — needs more data';
  return 'Early stage — insufficient signals for diagnosis';
}

// ─────────────────────────────────────────
// Main: Evaluate Campaign
// ─────────────────────────────────────────

/**
 * Main evaluation function. Combines lifecycle, funnel health, profit analysis,
 * and diagnosis into a single recommendation.
 */
export function evaluateCampaign(
  data: EvalCampaignData,
  config: EvalConfig
): CampaignEvaluation {
  // Skip paused campaigns
  if (data.fbStatus === 'PAUSED') {
    return {
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      lifecycle: 'PERFORMING',
      campType: 'MIXED',
      action: 'NO_ACTION',
      funnelHealth: 0,
      profitPerOrder: null,
      diagnosis: 'Campaign is paused',
      reasoning: 'Paused campaigns are not evaluated.',
      confidence: 100,
    };
  }

  const campType = classifyCampType(data.avgFrequency7d || data.frequency);
  const lifecycle = getLifecyclePhase(data, config);
  const funnelHealth = calculateFunnelHealth(data, campType, config);
  const profitPerOrder = data.profitPerOrder7d;
  const diagnosis = diagnoseFunnelCombo(data);

  // CPA tolerance: prospecting camps get 1.5× because they feed the funnel
  const cpaTolerance = campType === 'PROSPECTING' ? 1.5 : 1.0;
  const effectiveTargetCpa = config.targetCpa * cpaTolerance;

  let action: EvalAction;
  let reasoning: string;
  let confidence: number;

  switch (lifecycle) {
    case 'LEARNING':
      action = 'NO_ACTION';
      reasoning = `Spend $${data.spend7d.toFixed(0)} (< $${(config.targetCpa * 0.5).toFixed(0)} threshold). Insufficient data — let Meta optimize.`;
      confidence = 95;
      break;

    case 'EVALUATING': {
      // Has purchases — check profitability
      if (data.conversions7d > 0 && data.avgCPA7d !== null) {
        if (data.avgCPA7d <= effectiveTargetCpa * 1.5) {
          action = 'WATCH';
          reasoning = `CPA $${data.avgCPA7d.toFixed(0)} with ${data.conversions7d} conversions. Promising but needs more data to confirm stability.`;
          confidence = 65;
        } else {
          action = 'KILL';
          reasoning = `CPA $${data.avgCPA7d.toFixed(0)} exceeds ${(cpaTolerance * 1.5).toFixed(1)}× target ($${effectiveTargetCpa.toFixed(0)}). Unprofitable early signal.`;
          confidence = 70;
        }
        break;
      }

      // No purchases — use funnel signals
      if (funnelHealth >= 50) {
        action = 'WATCH';
        reasoning = `No purchases yet but funnel health ${funnelHealth}/100 shows promising signals (${diagnosis}). Give more time.`;
        confidence = 55;
      } else if (funnelHealth >= 30 && data.spend7d < config.breakevenCpa) {
        action = 'WATCH';
        reasoning = `Borderline funnel health ${funnelHealth}/100. Spend $${data.spend7d.toFixed(0)} hasn't reached breakeven CPA ($${config.breakevenCpa.toFixed(0)}). Still evaluating.`;
        confidence = 45;
      } else {
        action = 'KILL';
        reasoning = `Funnel health ${funnelHealth}/100 after $${data.spend7d.toFixed(0)} spend. ${diagnosis}. Low probability of recovery.`;
        confidence = 75;
      }
      break;
    }

    case 'PERFORMING':
      if (data.consecutiveProfitDays >= 3) {
        action = 'KEEP';
        reasoning = `Profitable ${data.consecutiveProfitDays} days. Profit/order: $${profitPerOrder?.toFixed(0) ?? 'N/A'}. Approaching scale readiness.`;
        confidence = 80;
      } else {
        action = 'KEEP';
        reasoning = `Converting with profit/order $${profitPerOrder?.toFixed(0) ?? 'N/A'} but not yet stable (${data.consecutiveProfitDays} consecutive profit days).`;
        confidence = 70;
      }
      break;

    case 'SCALING':
      action = 'SCALE';
      reasoning = `${data.consecutiveProfitDays} consecutive profit days. CPA $${data.avgCPA7d?.toFixed(0) ?? 'N/A'} vs target $${config.targetCpa}. Frequency ${data.avgFrequency7d.toFixed(1)} — headroom for growth.`;
      confidence = 85;
      break;

    case 'FATIGUED':
      action = 'REFRESH';
      reasoning = `CTR declined ${Math.abs(data.ctrTrend).toFixed(0)}% over recent days. Frequency ${data.avgFrequency7d.toFixed(1)}. Creative fatigue detected — refresh hooks/visuals before killing.`;
      confidence = 80;
      break;

    default:
      action = 'WATCH';
      reasoning = 'Unable to classify — monitoring.';
      confidence = 30;
  }

  return {
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    lifecycle,
    campType,
    action,
    funnelHealth,
    profitPerOrder: profitPerOrder ?? null,
    diagnosis,
    reasoning,
    confidence,
  };
}
