import { parseAmount, type Cents } from "./money.js";
import { parseRate } from "./validate.js";
import type { ExtractedInvoice } from "./schema.js";
import type { LedgerResult } from "./ledger.js";

/**
 * Mapping onto the two accounting packages that matter for this market.
 *
 * Both are built as *payloads*, not calls. The payload is what a prospect wants
 * to see and what an integration test can assert on, and it keeps the credential
 * handling — which is the part with real consequences — in one thin layer that
 * can be reviewed on its own.
 *
 * Field names follow each vendor's documented v2 / v1 REST shapes. Tax and
 * ledger identifiers are per-administration, so they are injected rather than
 * hardcoded: a wrong tax_rate_id posts a booking with the wrong btw, which is
 * exactly the failure that would cost a client an aangifte correction.
 */

export interface MoneybirdMapping {
  /** Maps a btw rate in basis points onto that administration's tax_rate_id. */
  taxRateIds: Record<number, string>;
  /** Maps a grootboekrekening code onto that administration's ledger_account_id. */
  ledgerAccountIds: Record<string, string>;
  contactId?: string;
}

export interface MoneybirdPayload {
  purchase_invoice: {
    contact_id: string | null;
    reference: string | null;
    date: string | null;
    due_date: string | null;
    currency: string;
    prices_are_incl_tax: false;
    details_attributes: Array<{
      description: string;
      price: string;
      amount: string;
      tax_rate_id: string | null;
      ledger_account_id: string | null;
    }>;
  };
}

export function toMoneybird(
  invoice: ExtractedInvoice,
  ledger: LedgerResult,
  mapping: MoneybirdMapping
): MoneybirdPayload {
  return {
    purchase_invoice: {
      contact_id: mapping.contactId ?? null,
      reference: invoice.factuurnummer,
      date: invoice.factuurdatum,
      due_date: invoice.vervaldatum,
      currency: invoice.valuta,
      // We always send exclusive prices because that is what we extracted and
      // validated. Letting the package derive the net from a gross amount would
      // reintroduce the rounding ambiguity we just eliminated.
      prices_are_incl_tax: false,
      details_attributes: invoice.regels.map((line, i) => {
        const bedrag = parseAmount(line.bedrag_excl_btw);
        const rate = invoice.btw_verlegd ? 0 : (parseRate(line.btw_percentage) ?? 0);
        const account = ledger.regels[i]?.account ?? null;
        return {
          description: line.omschrijving,
          // Moneybird multiplies price by amount, so the whole line value goes
          // in price with amount 1. Sending the printed quantity here would
          // double-apply it whenever the supplier's unit price was rounded.
          price: bedrag === null ? "0.00" : centsToDecimal(bedrag),
          amount: "1",
          tax_rate_id: mapping.taxRateIds[rate] ?? null,
          ledger_account_id: account ? (mapping.ledgerAccountIds[account.code] ?? null) : null,
        };
      }),
    },
  };
}

export interface ExactMapping {
  /** Exact Online VATCode per rate in basis points, e.g. 2100 -> "1". */
  vatCodes: Record<number, string>;
  /** GLAccount GUID per grootboekrekening code. */
  glAccounts: Record<string, string>;
  journal: string;
  supplierId?: string;
}

export interface ExactPayload {
  Supplier: string | null;
  Journal: string;
  EntryDate: string | null;
  DueDate: string | null;
  YourRef: string | null;
  Currency: string;
  VATAmountFC: number;
  PurchaseEntryLines: Array<{
    Description: string;
    AmountFC: number;
    GLAccount: string | null;
    VATCode: string | null;
  }>;
}

export function toExactOnline(
  invoice: ExtractedInvoice,
  ledger: LedgerResult,
  mapping: ExactMapping
): ExactPayload {
  const btw = parseAmount(invoice.totaal_btw) ?? 0;
  return {
    Supplier: mapping.supplierId ?? null,
    Journal: mapping.journal,
    EntryDate: invoice.factuurdatum ? `${invoice.factuurdatum}T00:00:00` : null,
    DueDate: invoice.vervaldatum ? `${invoice.vervaldatum}T00:00:00` : null,
    YourRef: invoice.factuurnummer,
    Currency: invoice.valuta,
    VATAmountFC: centsToNumber(btw),
    PurchaseEntryLines: invoice.regels.map((line, i) => {
      const bedrag = parseAmount(line.bedrag_excl_btw) ?? 0;
      const rate = invoice.btw_verlegd ? 0 : (parseRate(line.btw_percentage) ?? 0);
      const account = ledger.regels[i]?.account ?? null;
      return {
        Description: line.omschrijving.slice(0, 60),
        AmountFC: centsToNumber(bedrag),
        GLAccount: account ? (mapping.glAccounts[account.code] ?? null) : null,
        VATCode: mapping.vatCodes[rate] ?? null,
      };
    }),
  };
}

/** Cents to a fixed two-decimal string; never a float in the payload. */
function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Exact's JSON API takes numbers rather than strings for amounts, so this is
 * the one place a float is unavoidable. Two decimals of a value below 2^53/100
 * is exactly representable through this route, and we go via the string form so
 * the conversion can only ever produce the value we already computed in cents.
 */
function centsToNumber(cents: Cents): number {
  return Number(centsToDecimal(cents));
}

/** Demo mappings, shaped like real ones. Replaced per administration. */
export const DEMO_MONEYBIRD_MAPPING: MoneybirdMapping = {
  taxRateIds: { 2100: "313355264413370892", 900: "313355264430148109", 0: "313355264446925326" },
  ledgerAccountIds: {
    "4300": "313355264463702543", "4400": "313355264480479760", "4510": "313355264497256977",
    "4600": "313355264514034194", "4630": "313355264530811411", "4710": "313355264547588628",
    "4800": "313355264564365845", "4900": "313355264581143062", "7000": "313355264597920279",
  },
};

export const DEMO_EXACT_MAPPING: ExactMapping = {
  vatCodes: { 2100: "1", 900: "2", 0: "0" },
  glAccounts: {
    "4300": "b1e1f0b2-0000-4000-8000-000000004300",
    "4400": "b1e1f0b2-0000-4000-8000-000000004400",
    "4510": "b1e1f0b2-0000-4000-8000-000000004510",
    "4600": "b1e1f0b2-0000-4000-8000-000000004600",
    "4630": "b1e1f0b2-0000-4000-8000-000000004630",
    "4710": "b1e1f0b2-0000-4000-8000-000000004710",
    "4800": "b1e1f0b2-0000-4000-8000-000000004800",
    "4900": "b1e1f0b2-0000-4000-8000-000000004900",
    "7000": "b1e1f0b2-0000-4000-8000-000000007000",
  },
  journal: "70",
};
