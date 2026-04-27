/**
 * Timezone utility for AdPilot
 * 
 * Facebook Ad Accounts use a specific timezone (GMT-7 for this business).
 * All date calculations for campaigns, margin, and sync must align
 * to the ad account timezone, NOT the server's local time.
 * 
 * This prevents the "Today is which day?" bug where a VN server (UTC+7)
 * is 14 hours ahead of a US Pacific (UTC-7) ad account.
 */

/** The Facebook ad account timezone offset in hours from UTC */
const AD_ACCOUNT_UTC_OFFSET = -7; // GMT-7 (US Pacific / Mountain)

/**
 * Get the current date in the ad account's timezone.
 * 
 * IMPORTANT: Date.getTime() already returns UTC milliseconds.
 * We only need to shift by the ad account offset - NOT by getTimezoneOffset().
 * Previous code double-subtracted when running in non-UTC environments.
 */
export function getAdAccountToday(): string {
  const now = new Date();
  // getTime() is already UTC ms - just shift by ad account offset
  const adAccountMs = now.getTime() + AD_ACCOUNT_UTC_OFFSET * 3600000;
  const adAccountDate = new Date(adAccountMs);
  // Use UTC methods to extract date parts to avoid local timezone interference
  const y = adAccountDate.getUTCFullYear();
  const m = String(adAccountDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(adAccountDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get a date N days before the ad account's "today".
 */
export function getAdAccountDateMinusDays(days: number): string {
  const now = new Date();
  const adAccountMs = now.getTime() + AD_ACCOUNT_UTC_OFFSET * 3600000;
  const shifted = new Date(adAccountMs - days * 86400000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the current hour in the ad account's timezone (0-23).
 */
export function getAdAccountHour(): number {
  const now = new Date();
  const adAccountMs = now.getTime() + AD_ACCOUNT_UTC_OFFSET * 3600000;
  return new Date(adAccountMs).getUTCHours();
}

/**
 * Get the ad account timezone offset.
 */
export function getAdAccountOffset(): number {
  return AD_ACCOUNT_UTC_OFFSET;
}

/**
 * Convert a UTC ISO timestamp to a date string (YYYY-MM-DD) in the ad account timezone.
 * Use this to assign Shopify orders to the correct day aligned with Facebook data.
 * 
 * Example: "2026-04-21T02:00:00Z" in GMT-7 = "2026-04-20" (still previous day)
 */
export function convertToAdAccountDate(utcTimestamp: string): string {
  const d = new Date(utcTimestamp);
  // Shift to ad account timezone
  const adAccountMs = d.getTime() + AD_ACCOUNT_UTC_OFFSET * 3600000;
  const adDate = new Date(adAccountMs);
  const y = adDate.getUTCFullYear();
  const m = String(adDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(adDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
