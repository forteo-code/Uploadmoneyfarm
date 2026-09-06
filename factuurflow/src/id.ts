/**
 * Generators for structurally valid Dutch identifiers.
 *
 * The sample invoices need IBANs that pass mod-97 and btw numbers that pass the
 * 11-proef, otherwise the validator flags every sample and the demo proves the
 * opposite of what it should. Where a sample is *meant* to be wrong, it is made
 * wrong explicitly, not by accident.
 */

/** Builds a valid NL IBAN from a bank code and a 10-digit account number. */
export function nlIban(bank: string, account: string): string {
  const body = `${bank.toUpperCase()}${account.padStart(10, "0")}`;
  const rearranged = `${body}NL00`;
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  const check = String(98 - remainder).padStart(2, "0");
  return `NL${check}${body}`;
}

/**
 * Builds a NL btw-identificatienummer whose nine-digit body passes the 11-proef.
 *
 * Takes the first eight digits as given and solves for the ninth.
 */
export function nlBtw(eightDigits: string, suffix = "B01"): string {
  if (!/^\d{8}$/.test(eightDigits)) throw new Error("nlBtw: expected exactly 8 digits");
  // sum = d1*9 + d2*8 + ... + d8*2 - d9, and we need sum % 11 === 0.
  let weighted = 0;
  for (let i = 0; i < 8; i++) weighted += Number(eightDigits[i]) * (9 - i);
  const last = weighted % 11;
  if (last === 10) {
    // No single digit satisfies the proof for this stem; nudge the last input
    // digit and try again rather than emitting a number that fails validation.
    const bumped = eightDigits.slice(0, 7) + String((Number(eightDigits[7]) + 1) % 10);
    return nlBtw(bumped, suffix);
  }
  return `NL${eightDigits}${last}${suffix}`;
}

export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}
