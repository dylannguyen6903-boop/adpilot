/**
 * Business Defaults — Single Source of Truth
 * 
 * All fallback values for business profile fields MUST use these constants.
 * DO NOT hardcode fallback numbers elsewhere in the codebase.
 * 
 * If the user has saved their profile, these won't be used.
 * These are ONLY fallbacks when profile is missing or partially initialized.
 */

export const BIZ_DEFAULTS = {
  /** Cost of Goods Sold rate (0-1). 0.32 = 32% of revenue goes to COGS */
  COGS_RATE: 0.32,

  /** Target Cost Per Acquisition in USD */
  TARGET_CPA: 42,

  /** Average Order Value in USD */
  AOV: 86,

  /** Monthly profit target in USD */
  MONTHLY_PROFIT_TARGET: 15000,

  /** Target margin range */
  TARGET_MARGIN_MIN: 0.15,
  TARGET_MARGIN_MAX: 0.35,
} as const;
