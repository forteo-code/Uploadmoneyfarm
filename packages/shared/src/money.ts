/**
 * All money in this system is an integer number of micros.
 *   1 USD = 1_000_000 micros.
 *
 * Rationale: ad revenue arrives as fractions of a cent per impression. A view
 * worth $0.0004 is 400 micros - representable exactly. Floats are never used
 * anywhere near a balance, and every ledger amount is a BigInt.
 */
export const MICROS_PER_UNIT = 1_000_000n;

export type Micros = bigint;

export function usdToMicros(usd: number): Micros {
  if (!Number.isFinite(usd)) throw new Error("usdToMicros: non-finite input");
  // Round half away from zero at the micro boundary.
  return BigInt(Math.round(usd * 1_000_000));
}

export function microsToUsd(micros: Micros): number {
  return Number(micros) / 1_000_000;
}

/** Human display, always 2dp, for dashboards and payout screens. */
export function formatMicros(micros: Micros, currency = "USD"): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  // Round to cents.
  const cents = (frac + 5000n) / 10_000n;
  const carry = cents >= 100n ? 1n : 0n;
  const displayCents = cents >= 100n ? 0n : cents;
  const sign = neg ? "-" : "";
  return `${sign}${whole + carry}.${displayCents.toString().padStart(2, "0")} ${currency}`;
}

/**
 * CPM is priced per 1000 impressions. Splitting a CPM across a single view
 * loses precision if done naively, so we work in micros throughout and
 * truncate only at the end.
 */
export function cpmToPerViewMicros(cpmMicros: Micros): Micros {
  return cpmMicros / 1000n;
}

/**
 * Uploader share is stored in basis points (1 bp = 0.01%). 3500 bp = 35%.
 * Truncation favours the house, which is both conventional and keeps the
 * platform from ever paying out more than it took in.
 */
export function applyRevShare(grossMicros: Micros, shareBps: number): Micros {
  if (shareBps < 0 || shareBps > 10_000) throw new Error("applyRevShare: bps out of range");
  return (grossMicros * BigInt(shareBps)) / 10_000n;
}
