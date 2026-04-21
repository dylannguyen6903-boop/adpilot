/**
 * LTV (Lifetime Value) Calculator for AdPilot
 * 
 * Implements the dual optimization model:
 * - Calculates LTV factor based on returning customer rate
 * - Determines max allowable CPA considering LTV
 * - Adjusts CPA threshold based on target margin constraints
 */

import type { LTVParams, LTVResult } from '@/types/financial';

const DEFAULT_LTV_PARAMS: LTVParams = {
  returningRate: 0.22,
  avgRepeatOrders: 1.5,
  aov: 87,
  targetMarginMin: 0.17,
  targetMarginMax: 0.20,
};

/**
 * Calculate LTV metrics from business parameters.
 * 
 * Formula:
 *   LTV_Factor = 1 + (returning_rate × avg_repeat_orders)
 *   Customer_LTV = AOV × LTV_Factor
 *   LTV_Profit = Customer_LTV × target_margin
 *   Max_Allowable_CPA = LTV_Profit
 */
export function calculateLTV(params: Partial<LTVParams> = {}): LTVResult {
  const p = { ...DEFAULT_LTV_PARAMS, ...params };

  const ltvFactor = 1 + (p.returningRate * p.avgRepeatOrders);
  const customerLtv = p.aov * ltvFactor;
  const ltvProfitFloor = customerLtv * p.targetMarginMin;
  const ltvProfitCeiling = customerLtv * p.targetMarginMax;

  return {
    ltvFactor: round(ltvFactor, 4),
    customerLtv: round(customerLtv, 2),
    ltvProfit: round(ltvProfitCeiling, 2),
    maxAllowableCpa: round(ltvProfitCeiling, 2),
    maxAllowableCpaCeiling: round(ltvProfitCeiling, 2),   // using max margin
    maxAllowableCpaFloor: round(ltvProfitFloor, 2),        // using min margin
  };
}

/**
 * Convert a raw (first-order) CPA to an LTV-adjusted CPA.
 * 
 * LTV-adjusted CPA = First_Order_CPA / LTV_Factor
 * 
 * This represents the "true cost" per customer when accounting for repeat purchases.
 */
export function ltvAdjustedCPA(
  firstOrderCpa: number,
  params: Partial<LTVParams> = {}
): number {
  const p = { ...DEFAULT_LTV_PARAMS, ...params };
  const ltvFactor = 1 + (p.returningRate * p.avgRepeatOrders);
  return round(firstOrderCpa / ltvFactor, 2);
}

/**
 * Check if a campaign's CPA is acceptable under the LTV model.
 * 
 * Returns:
 * - 'PROFITABLE' if LTV-adjusted CPA < max allowable (floor margin)
 * - 'MARGINAL' if LTV-adjusted CPA is between floor and ceiling
 * - 'UNPROFITABLE' if LTV-adjusted CPA > max allowable (ceiling margin)
 */
export function evaluateCPAHealth(
  firstOrderCpa: number,
  params: Partial<LTVParams> = {}
): { status: 'PROFITABLE' | 'MARGINAL' | 'UNPROFITABLE'; ltvAdjCpa: number; maxCpa: number } {
  const ltv = calculateLTV(params);
  const ltvAdjCpa = ltvAdjustedCPA(firstOrderCpa, params);

  let status: 'PROFITABLE' | 'MARGINAL' | 'UNPROFITABLE';

  if (ltvAdjCpa <= ltv.maxAllowableCpaFloor) {
    status = 'PROFITABLE';
  } else if (ltvAdjCpa <= ltv.maxAllowableCpaCeiling) {
    status = 'MARGINAL';
  } else {
    status = 'UNPROFITABLE';
  }

  return { status, ltvAdjCpa, maxCpa: ltv.maxAllowableCpa };
}

/** Round to N decimal places */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
