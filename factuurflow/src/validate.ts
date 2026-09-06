import { type Cents, btwOver, formatEuro, parseAmount } from "./money.js";
import type { ExtractedInvoice } from "./schema.js";

/**
 * Deterministic checks over a model-extracted invoice.
 *
 * This is the part of the product that is not a language model. Extraction is
 * probabilistic; bookkeeping is not. Everything here is arithmetic, checksums
 * and format rules, so that "auto-post" is a claim we can defend line by line
 * when an accountant asks why a booking went through unattended.
 *
 * Rule of thumb used throughout: an `error` blocks automatic posting, a
 * `warning` posts but is surfaced, an `info` is context for the reviewer.
 */

export type Severity = "error" | "warning" | "info";

export interface Finding {
  code: string;
  severity: Severity;
  field: string;
  message: string;
  expected?: string;
  found?: string;
}

export interface ValidationResult {
  findings: Finding[];
  decision: "auto_post" | "review";
  totals: {
    subtotaalExcl: Cents | null;
    totaalBtw: Cents | null;
    totaalIncl: Cents | null;
    regelsSom: Cents | null;
  };
  /** Cents of tolerance we allowed on each reconciliation, for the audit trail. */
  tolerance: Cents;
}

/**
 * Rounding tolerance on reconciliation.
 *
 * Suppliers compute BTW per line, per group, or over the invoice total, and the
 * three disagree by a cent or two on a long invoice. One cent per line plus a
 * two-cent floor absorbs that without absorbing a real error: a transposed
 * digit or a dropped line moves the total by far more.
 */
function toleranceFor(lineCount: number): Cents {
  return Math.max(2, lineCount);
}

export function validateInvoice(inv: ExtractedInvoice): ValidationResult {
  const f: Finding[] = [];
  const tolerance = toleranceFor(inv.regels.length);

  const subtotaal = amount(f, "subtotaal_excl_btw", inv.subtotaal_excl_btw, "error");
  const totaalBtw = amount(f, "totaal_btw", inv.totaal_btw, "error");
  const totaalIncl = amount(f, "totaal_incl_btw", inv.totaal_incl_btw, "error");

  checkIdentity(f, inv);
  checkDates(f, inv);
  const regelsSom = checkLines(f, inv, subtotaal, tolerance);
  checkBtwSpecification(f, inv, subtotaal, totaalBtw, tolerance);
  checkGrandTotal(f, subtotaal, totaalBtw, totaalIncl, tolerance);
  checkSigns(f, inv, totaalIncl);

  return {
    findings: f,
    decision: f.some((x) => x.severity === "error") ? "review" : "auto_post",
    totals: { subtotaalExcl: subtotaal, totaalBtw, totaalIncl, regelsSom },
    tolerance,
  };
}

/* ------------------------------------------------------------------ */
/* Identity: who sent this, and are their numbers real                  */
/* ------------------------------------------------------------------ */

function checkIdentity(f: Finding[], inv: ExtractedInvoice): void {
  const sup = inv.leverancier;

  if (!inv.factuurnummer) {
    f.push({
      code: "MISSING_INVOICE_NUMBER",
      severity: "error",
      field: "factuurnummer",
      message:
        "Geen factuurnummer gevonden. Een factuurnummer is een wettelijk verplicht factuurvereiste.",
    });
  }

  if (!sup.naam) {
    f.push({
      code: "MISSING_SUPPLIER",
      severity: "error",
      field: "leverancier.naam",
      message: "Geen leveranciersnaam gevonden.",
    });
  }

  if (sup.iban) {
    const iban = sup.iban.replace(/\s/g, "").toUpperCase();
    if (!isValidIban(iban)) {
      f.push({
        code: "IBAN_CHECKSUM_FAILED",
        severity: "error",
        field: "leverancier.iban",
        message:
          "IBAN voldoet niet aan de mod-97 controle. Betaal niet voordat dit handmatig is geverifieerd — dit is het patroon van factuurfraude.",
        found: iban,
      });
    }
  } else {
    f.push({
      code: "MISSING_IBAN",
      severity: "warning",
      field: "leverancier.iban",
      message: "Geen IBAN op de factuur; betaling kan niet automatisch klaargezet worden.",
    });
  }

  if (sup.btw_nummer) {
    const btw = sup.btw_nummer.replace(/[\s.]/g, "").toUpperCase();
    const shape = btwNumberShape(btw);
    if (shape === "invalid") {
      f.push({
        code: "BTW_NUMBER_MALFORMED",
        severity: "error",
        field: "leverancier.btw_nummer",
        message: "Btw-identificatienummer heeft geen geldig formaat.",
        found: btw,
      });
    } else if (shape === "nl" && !dutchBtwPassesElevenProef(btw)) {
      // Nederlandse btw-id's van rechtspersonen zijn afgeleid van het RSIN en
      // voldoen aan de 11-proef. Btw-id's van eenmanszaken (sinds 2020) zijn
      // willekeurig en doen dat niet. Daarom een waarschuwing, geen fout.
      f.push({
        code: "BTW_NUMBER_ELEVEN_PROOF",
        severity: "warning",
        field: "leverancier.btw_nummer",
        message:
          "Btw-nummer voldoet niet aan de 11-proef. Normaal voor een eenmanszaak, verdacht bij een BV. Controleer via het VIES-register.",
        found: btw,
      });
    }
  } else if (!inv.btw_verlegd) {
    f.push({
      code: "MISSING_BTW_NUMBER",
      severity: "warning",
      field: "leverancier.btw_nummer",
      message: "Geen btw-identificatienummer van de leverancier gevonden.",
    });
  }

  if (sup.kvk_nummer && !/^\d{8}$/.test(sup.kvk_nummer.replace(/\s/g, ""))) {
    f.push({
      code: "KVK_MALFORMED",
      severity: "warning",
      field: "leverancier.kvk_nummer",
      message: "KvK-nummer is geen 8 cijfers.",
      found: sup.kvk_nummer,
    });
  }

  if (sup.postcode && !/^\d{4}\s?[A-Za-z]{2}$/.test(sup.postcode.trim())) {
    f.push({
      code: "POSTCODE_MALFORMED",
      severity: "info",
      field: "leverancier.postcode",
      message: "Postcode heeft geen Nederlands formaat (1234 AB). Mogelijk buitenlands adres.",
      found: sup.postcode,
    });
  }

  if (inv.valuta !== "EUR") {
    f.push({
      code: "NON_EUR_CURRENCY",
      severity: "warning",
      field: "valuta",
      message: `Factuur in ${inv.valuta}. Boeking vereist een wisselkoers op factuurdatum.`,
      found: inv.valuta,
    });
  }

  if (inv.document_type === "onbekend") {
    f.push({
      code: "UNKNOWN_DOCUMENT_TYPE",
      severity: "error",
      field: "document_type",
      message: "Documenttype niet vastgesteld. Mogelijk geen factuur.",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

function checkDates(f: Finding[], inv: ExtractedInvoice): void {
  const invoiceDate = isoDate(inv.factuurdatum);
  const dueDate = isoDate(inv.vervaldatum);

  if (!inv.factuurdatum) {
    f.push({
      code: "MISSING_INVOICE_DATE",
      severity: "error",
      field: "factuurdatum",
      message: "Geen factuurdatum gevonden. Verplicht factuurvereiste en nodig voor de btw-aangifte.",
    });
  } else if (!invoiceDate) {
    f.push({
      code: "INVOICE_DATE_UNPARSEABLE",
      severity: "error",
      field: "factuurdatum",
      message: "Factuurdatum is geen geldige datum.",
      found: inv.factuurdatum,
    });
  }

  if (inv.vervaldatum && !dueDate) {
    f.push({
      code: "DUE_DATE_UNPARSEABLE",
      severity: "warning",
      field: "vervaldatum",
      message: "Vervaldatum is geen geldige datum.",
      found: inv.vervaldatum,
    });
  }

  if (invoiceDate && dueDate && dueDate < invoiceDate) {
    f.push({
      code: "DUE_BEFORE_INVOICE",
      severity: "error",
      field: "vervaldatum",
      message: "Vervaldatum ligt vóór de factuurdatum.",
      expected: `>= ${inv.factuurdatum}`,
      found: inv.vervaldatum ?? "",
    });
  }

  if (invoiceDate) {
    const now = Date.now();
    const ahead = (invoiceDate.getTime() - now) / 86_400_000;
    if (ahead > 1) {
      f.push({
        code: "INVOICE_DATE_IN_FUTURE",
        severity: "warning",
        field: "factuurdatum",
        message: `Factuurdatum ligt ${Math.round(ahead)} dagen in de toekomst.`,
        found: inv.factuurdatum ?? "",
      });
    }
    const behind = (now - invoiceDate.getTime()) / 86_400_000;
    if (behind > 365 * 5) {
      f.push({
        code: "INVOICE_DATE_VERY_OLD",
        severity: "warning",
        field: "factuurdatum",
        message: "Factuurdatum is ouder dan vijf jaar; buiten de bewaartermijn en waarschijnlijk fout gelezen.",
        found: inv.factuurdatum ?? "",
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Line arithmetic                                                      */
/* ------------------------------------------------------------------ */

function checkLines(
  f: Finding[],
  inv: ExtractedInvoice,
  subtotaal: Cents | null,
  tolerance: Cents
): Cents | null {
  if (inv.regels.length === 0) {
    f.push({
      code: "NO_LINES",
      severity: "error",
      field: "regels",
      message: "Geen factuurregels herkend.",
    });
    return null;
  }

  let sum = 0;
  let usable = true;

  inv.regels.forEach((line, i) => {
    const bedrag = parseAmount(line.bedrag_excl_btw);
    if (bedrag === null) {
      usable = false;
      f.push({
        code: "LINE_AMOUNT_UNPARSEABLE",
        severity: "error",
        field: `regels[${i}].bedrag_excl_btw`,
        message: `Regelbedrag onleesbaar op regel ${i + 1}: "${line.omschrijving}".`,
        found: line.bedrag_excl_btw,
      });
      return;
    }
    sum += bedrag;

    const rate = parseRate(line.btw_percentage);
    if (rate === null) {
      f.push({
        code: "LINE_RATE_UNPARSEABLE",
        severity: "error",
        field: `regels[${i}].btw_percentage`,
        message: `Btw-percentage onleesbaar op regel ${i + 1}.`,
        found: line.btw_percentage,
      });
    } else if (![0, 900, 2100].includes(rate)) {
      f.push({
        code: "UNUSUAL_BTW_RATE",
        severity: "warning",
        field: `regels[${i}].btw_percentage`,
        message: `Ongebruikelijk btw-tarief van ${rate / 100}% op regel ${i + 1}. Controleer of dit klopt.`,
        found: line.btw_percentage,
      });
    }

    // Quantity x unit price should reproduce the line amount when both are printed.
    const qty = parseQuantity(line.aantal);
    const unit = parseAmount(line.eenheidsprijs);
    if (qty !== null && unit !== null) {
      const expected = Math.round(qty * unit);
      if (Math.abs(expected - bedrag) > 1) {
        f.push({
          code: "LINE_PRODUCT_MISMATCH",
          severity: "warning",
          field: `regels[${i}].bedrag_excl_btw`,
          message: `Regel ${i + 1}: aantal x eenheidsprijs komt niet uit op het regelbedrag.`,
          expected: formatEuro(expected),
          found: formatEuro(bedrag),
        });
      }
    }
  });

  if (!usable) return null;

  if (subtotaal !== null && Math.abs(sum - subtotaal) > tolerance) {
    f.push({
      code: "LINES_DO_NOT_SUM_TO_SUBTOTAL",
      severity: "error",
      field: "subtotaal_excl_btw",
      message:
        "De som van de factuurregels wijkt af van het afgedrukte subtotaal. Er ontbreekt een regel of een bedrag is verkeerd gelezen.",
      expected: formatEuro(sum),
      found: formatEuro(subtotaal),
    });
  }

  return sum;
}

/* ------------------------------------------------------------------ */
/* BTW per rate                                                         */
/* ------------------------------------------------------------------ */

function checkBtwSpecification(
  f: Finding[],
  inv: ExtractedInvoice,
  subtotaal: Cents | null,
  totaalBtw: Cents | null,
  tolerance: Cents
): void {
  if (inv.btw_verlegd) {
    if (totaalBtw !== null && totaalBtw !== 0) {
      f.push({
        code: "REVERSE_CHARGE_WITH_BTW",
        severity: "error",
        field: "totaal_btw",
        message: "Factuur vermeldt 'btw verlegd' maar brengt toch btw in rekening.",
        found: formatEuro(totaalBtw),
      });
    }
    return;
  }

  if (inv.btw_specificatie.length === 0) {
    // Fall back to deriving the expected BTW from the lines themselves.
    const derived = deriveBtwFromLines(inv);
    if (derived !== null && totaalBtw !== null && Math.abs(derived - totaalBtw) > tolerance) {
      f.push({
        code: "BTW_TOTAL_MISMATCH_FROM_LINES",
        severity: "error",
        field: "totaal_btw",
        message: "Btw berekend over de regeltarieven wijkt af van het afgedrukte btw-totaal.",
        expected: formatEuro(derived),
        found: formatEuro(totaalBtw),
      });
    }
    return;
  }

  let groupBase = 0;
  let groupBtw = 0;

  inv.btw_specificatie.forEach((g, i) => {
    const base = parseAmount(g.grondslag);
    const btw = parseAmount(g.btw_bedrag);
    const rate = parseRate(g.btw_percentage);

    if (base === null || btw === null || rate === null) {
      f.push({
        code: "BTW_GROUP_UNPARSEABLE",
        severity: "error",
        field: `btw_specificatie[${i}]`,
        message: `Btw-uitsplitsing ${i + 1} is niet volledig te lezen.`,
      });
      return;
    }

    groupBase += base;
    groupBtw += btw;

    const expected = btwOver(base, rate);
    if (Math.abs(expected - btw) > 1) {
      f.push({
        code: "BTW_GROUP_ARITHMETIC",
        severity: "error",
        field: `btw_specificatie[${i}].btw_bedrag`,
        message: `${rate / 100}% over ${formatEuro(base)} komt niet uit op het vermelde btw-bedrag.`,
        expected: formatEuro(expected),
        found: formatEuro(btw),
      });
    }
  });

  if (subtotaal !== null && Math.abs(groupBase - subtotaal) > tolerance) {
    f.push({
      code: "BTW_BASE_MISMATCH",
      severity: "error",
      field: "btw_specificatie",
      message: "De grondslagen in de btw-uitsplitsing tellen niet op tot het subtotaal exclusief btw.",
      expected: formatEuro(subtotaal),
      found: formatEuro(groupBase),
    });
  }

  if (totaalBtw !== null && Math.abs(groupBtw - totaalBtw) > tolerance) {
    f.push({
      code: "BTW_TOTAL_MISMATCH",
      severity: "error",
      field: "totaal_btw",
      message: "De btw-bedragen per tarief tellen niet op tot het vermelde btw-totaal.",
      expected: formatEuro(groupBtw),
      found: formatEuro(totaalBtw),
    });
  }
}

function deriveBtwFromLines(inv: ExtractedInvoice): Cents | null {
  let total = 0;
  for (const line of inv.regels) {
    const bedrag = parseAmount(line.bedrag_excl_btw);
    const rate = parseRate(line.btw_percentage);
    if (bedrag === null || rate === null) return null;
    total += btwOver(bedrag, rate);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Grand total and sign consistency                                     */
/* ------------------------------------------------------------------ */

function checkGrandTotal(
  f: Finding[],
  subtotaal: Cents | null,
  totaalBtw: Cents | null,
  totaalIncl: Cents | null,
  tolerance: Cents
): void {
  if (subtotaal === null || totaalBtw === null || totaalIncl === null) return;
  const expected = subtotaal + totaalBtw;
  if (Math.abs(expected - totaalIncl) > tolerance) {
    f.push({
      code: "GRAND_TOTAL_MISMATCH",
      severity: "error",
      field: "totaal_incl_btw",
      message: "Subtotaal plus btw komt niet uit op het eindtotaal.",
      expected: formatEuro(expected),
      found: formatEuro(totaalIncl),
    });
  }
}

function checkSigns(f: Finding[], inv: ExtractedInvoice, totaalIncl: Cents | null): void {
  if (totaalIncl === null) return;

  if (inv.document_type === "creditnota" && totaalIncl > 0) {
    f.push({
      code: "CREDIT_NOTE_POSITIVE",
      severity: "warning",
      field: "totaal_incl_btw",
      message:
        "Creditnota met een positief eindtotaal. Veel leveranciers drukken creditnota's positief af; het bedrag wordt negatief geboekt.",
      found: formatEuro(totaalIncl),
    });
  }

  if (inv.document_type === "factuur" && totaalIncl < 0) {
    f.push({
      code: "INVOICE_NEGATIVE",
      severity: "error",
      field: "totaal_incl_btw",
      message: "Factuur met een negatief eindtotaal. Waarschijnlijk een creditnota.",
      found: formatEuro(totaalIncl),
    });
  }

  if (totaalIncl === 0) {
    f.push({
      code: "ZERO_TOTAL",
      severity: "warning",
      field: "totaal_incl_btw",
      message: "Eindtotaal is nul.",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Primitives                                                           */
/* ------------------------------------------------------------------ */

function amount(f: Finding[], field: string, raw: string, severity: Severity): Cents | null {
  const parsed = parseAmount(raw);
  if (parsed === null) {
    f.push({
      code: "AMOUNT_UNPARSEABLE",
      severity,
      field,
      message: `Bedrag in veld ${field} is niet te lezen als bedrag.`,
      found: raw,
    });
  }
  return parsed;
}

/** Returns the rate in basis points: "21" -> 2100, "21%" -> 2100, "9,0" -> 900. */
export function parseRate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace("%", "").replace(",", ".").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

function parseQuantity(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isoDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Rejects 2025-02-30, which Date would happily roll into March.
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date;
}

/** ISO 13616 mod-97 check. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

const EU_BTW_PATTERNS: Record<string, RegExp> = {
  NL: /^NL\d{9}B\d{2}$/,
  // GB is no longer an EU member, but UK suppliers still print a VAT number and
  // it still has to reconcile: standard (9 digits), branch (12), and the
  // government/health-authority forms.
  GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  BE: /^BE0\d{9}$/,
  DE: /^DE\d{9}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  LU: /^LU\d{8}$/,
  IE: /^IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  IT: /^IT\d{11}$/,
  AT: /^ATU\d{8}$/,
  PL: /^PL\d{10}$/,
  DK: /^DK\d{8}$/,
  SE: /^SE\d{12}$/,
};

export function btwNumberShape(raw: string): "nl" | "eu" | "invalid" {
  const btw = raw.replace(/[\s.-]/g, "").toUpperCase();
  const country = btw.slice(0, 2);
  const pattern = EU_BTW_PATTERNS[country];
  if (!pattern) return "invalid";
  if (!pattern.test(btw)) return "invalid";
  return country === "NL" ? "nl" : "eu";
}

/**
 * The classic Dutch 11-proef over the nine-digit body of a NL btw number.
 *
 * Holds for numbers derived from an RSIN (legal entities). Btw-id's issued to
 * sole traders since 2020 are deliberately random and will not pass, so a
 * failure here is a signal to check VIES, not proof of a bad number.
 */
export function dutchBtwPassesElevenProef(raw: string): boolean {
  const btw = raw.replace(/[\s.-]/g, "").toUpperCase();
  const body = btw.slice(2, 11);
  if (!/^\d{9}$/.test(body)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(body[i]);
    const weight = i === 8 ? -1 : 9 - i;
    sum += digit * weight;
  }
  return sum % 11 === 0;
}
