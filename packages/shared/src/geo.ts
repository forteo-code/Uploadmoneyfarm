/**
 * Geo tiering drives two independent decisions:
 *
 *   1. REVENUE  - what an impression from this country is worth.
 *   2. COST     - what video quality we are willing to spend bandwidth on.
 *
 * Tying (2) to (1) is the single largest margin lever in the product. A view
 * from a country paying $0.40 RPM does not justify a 720p stream that costs
 * more to deliver than the ads on it earn. So tier 3 is capped at 480p.
 *
 * 1080p is disabled globally by default: it roughly doubles per-view bandwidth
 * against 720p for a quality difference that an embedded, ad-laden player does
 * not meaningfully surface. Operators can raise TIER_MAX_HEIGHT for tier 1 from
 * the admin config once they have revenue data that justifies it.
 */
export type CpmTier = 1 | 2 | 3;

export const TIER_MAX_HEIGHT: Record<CpmTier, number> = {
  1: 720,
  2: 720,
  3: 480,
};

/** Planning estimates only. Real values come from the AdNetwork revenue table. */
export const TIER_BASELINE_RPM_MICROS: Record<CpmTier, bigint> = {
  1: 3_000_000n, // ~$3.00 per 1000 views, full ad stack
  2: 1_000_000n, // ~$1.00
  3: 350_000n,   // ~$0.35
};

const TIER_1 = new Set([
  "US", "CA", "GB", "AU", "NZ", "IE", "DE", "AT", "CH", "NL", "BE",
  "SE", "NO", "DK", "FI", "IS", "LU", "SG", "JP", "KR",
]);

const TIER_2 = new Set([
  "FR", "IT", "ES", "PT", "GR", "PL", "CZ", "SK", "HU", "RO", "BG",
  "HR", "SI", "EE", "LV", "LT", "IL", "AE", "SA", "QA", "KW", "TW",
  "HK", "MY", "CL", "AR", "UY", "CR", "PA", "ZA", "TR", "MX", "BR",
]);

export function tierForCountry(code: string | null | undefined): CpmTier {
  if (!code) return 3;
  const c = code.toUpperCase();
  if (TIER_1.has(c)) return 1;
  if (TIER_2.has(c)) return 2;
  return 3;
}

export function maxHeightForCountry(code: string | null | undefined): number {
  return TIER_MAX_HEIGHT[tierForCountry(code)];
}
