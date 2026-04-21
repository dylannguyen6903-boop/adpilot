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
 * Example: If server is UTC+7 and it's 6am Apr 21 in VN,
 *          the ad account (UTC-7) sees 4pm Apr 20.
 */
export function getAdAccountToday(): string {
  const now = new Date();
  // Convert to UTC, then apply ad account offset
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const adAccountMs = utcMs + AD_ACCOUNT_UTC_OFFSET * 3600000;
  const adAccountDate = new Date(adAccountMs);
  return adAccountDate.toISOString().split('T')[0];
}

/**
 * Get a date N days before the ad account's "today".
 */
export function getAdAccountDateMinusDays(days: number): string {
  const today = getAdAccountToday();
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Get the current hour in the ad account's timezone (0-23).
 */
export function getAdAccountHour(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const adAccountMs = utcMs + AD_ACCOUNT_UTC_OFFSET * 3600000;
  return new Date(adAccountMs).getHours();
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
  return adDate.toISOString().split('T')[0];
}
