import { describe, it, expect } from "vitest";
import { usdToMicros, microsToUsd, formatMicros, cpmToPerViewMicros, applyRevShare, MICROS_PER_UNIT } from "./money.js";

describe("money", () => {
  it("round-trips whole and fractional dollars", () => {
    expect(usdToMicros(1)).toBe(1_000_000n);
    expect(usdToMicros(0.35)).toBe(350_000n);
    expect(microsToUsd(350_000n)).toBeCloseTo(0.35, 9);
  });

  it("represents sub-cent amounts exactly, which is the whole point", () => {
    // A single tier-3 view is worth a small fraction of a cent. Float cents
    // would round this to zero and the uploader would earn nothing.
    const perView = cpmToPerViewMicros(350_000n);
    expect(perView).toBe(350n);
    expect(perView).toBeGreaterThan(0n);
  });

  it("formats to two decimal places with correct rounding", () => {
    expect(formatMicros(0n)).toBe("0.00 USD");
    expect(formatMicros(1_000_000n)).toBe("1.00 USD");
    expect(formatMicros(1_234_567n)).toBe("1.23 USD");
    expect(formatMicros(1_235_000n)).toBe("1.24 USD");
    expect(formatMicros(-2_500_000n)).toBe("-2.50 USD");
  });

  it("carries correctly when rounding crosses a whole unit", () => {
    // 1.999 rounds to 2.00, not 1.100 - a naive carry gets this wrong.
    expect(formatMicros(1_999_000n)).toBe("2.00 USD");
    expect(formatMicros(9_999_999n)).toBe("10.00 USD");
  });

  describe("revenue share", () => {
    it("applies basis points", () => {
      expect(applyRevShare(1_000_000n, 3500)).toBe(350_000n);
      expect(applyRevShare(1_000_000n, 10_000)).toBe(1_000_000n);
      expect(applyRevShare(1_000_000n, 0)).toBe(0n);
    });

    it("truncates in the platform's favour, never paying out more than it took", () => {
      // 350 micros at 35% is 122.5; truncation gives 122, so the platform
      // keeps the half-micro rather than creating money.
      const gross = 350n;
      const share = applyRevShare(gross, 3500);
      expect(share).toBe(122n);
      expect(share).toBeLessThan(gross);
    });

    it("never exceeds gross for any share and amount", () => {
      for (const gross of [1n, 7n, 350n, 999_999n, 12_345_678n]) {
        for (const bps of [1, 500, 3500, 9999, 10_000]) {
          expect(applyRevShare(gross, bps)).toBeLessThanOrEqual(gross);
        }
      }
    });

    it("rejects out-of-range basis points rather than silently misapplying them", () => {
      expect(() => applyRevShare(1_000_000n, 10_001)).toThrow();
      expect(() => applyRevShare(1_000_000n, -1)).toThrow();
    });
  });

  it("keeps precision across a large view volume", () => {
    // Ten million tier-3 views at 35%: the sum must be exact, with no drift.
    const perView = applyRevShare(cpmToPerViewMicros(350_000n), 3500);
    const total = perView * 10_000_000n;
    expect(total).toBe(1_220_000_000n);
    expect(total / MICROS_PER_UNIT).toBe(1220n);
  });
});
