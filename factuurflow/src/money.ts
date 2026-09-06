/**
 * All money in this system is integer eurocents. Never floats.
 *
 * Invoice arithmetic has to reconcile to the cent or an accountant will not
 * accept the booking, and a float `0.1 + 0.2` will lose you that argument.
 */

export type Cents = number;

const AMOUNT_RE = /^-?\d{1,12}([.,]\d{1,2})?$/;

/**
 * Parses an amount as it appears on a Dutch invoice into cents.
 *
 * Accepts the shapes a model or an OCR layer realistically emits:
 * "1.234,56" (NL), "1,234.56" (EN), "1234.5", "1234", "€ 1.234,56", "-12,00".
 * Returns null rather than guessing when the string is ambiguous garbage,
 * because a silently wrong amount is worse than a flagged one.
 */
export function parseAmount(raw: string | number | null | undefined): Cents | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }

  let s = raw.trim();
  if (s === "") return null;

  // Strip currency symbols, codes and non-breaking spaces.
  s = s.replace(/[€$£]|EUR|eur/g, "").replace(/ /g, " ").trim();

  // Trailing minus ("1.234,56-") is common on bank and ERP exports.
  let negative = false;
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }

  s = s.replace(/\s/g, "");

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    // Both separators present: the rightmost one is the decimal separator.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const tail = s.length - lastComma - 1;
    // "1,234" is a thousands group; "1,23" is a decimal.
    s = tail === 3 && /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot !== -1) {
    const tail = s.length - lastDot - 1;
    s = tail === 3 && /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  }

  if (!AMOUNT_RE.test(s)) return null;

  const [whole = "0", frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function formatEuro(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("nl-NL");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}€ ${whole},${frac}`;
}

/** Half-up rounding, which is what the Belastingdienst expects on BTW. */
export function roundCents(value: number): Cents {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** BTW over a base amount, at a rate in basis points (2100 = 21%). */
export function btwOver(baseCents: Cents, rateBps: number): Cents {
  return roundCents((baseCents * rateBps) / 10_000);
}
