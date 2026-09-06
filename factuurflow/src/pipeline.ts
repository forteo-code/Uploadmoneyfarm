import { extractFromBuffer, estimateCostCents, type ExtractionMeta } from "./extract.js";
import { validateInvoice, type Finding, type ValidationResult } from "./validate.js";
import { classify, type LedgerResult } from "./ledger.js";
import {
  DEMO_EXACT_MAPPING,
  DEMO_MONEYBIRD_MAPPING,
  toExactOnline,
  toMoneybird,
  type ExactPayload,
  type MoneybirdPayload,
} from "./accounting.js";
import type { ExtractedInvoice } from "./schema.js";

/**
 * The whole thing, end to end: document in, posting decision out.
 *
 * The order is the argument. Read, then check the arithmetic, then classify,
 * then build the booking. Nothing downstream of the validator ever sees an
 * invoice that failed it without also seeing why.
 */

export type Beslissing = "auto_post" | "review";

export interface ProcessResult {
  bestandsnaam: string;
  bron: "api" | "fixture";
  invoice: ExtractedInvoice;
  validatie: ValidationResult;
  grootboek: LedgerResult;
  beslissing: Beslissing;
  redenen: Finding[];
  moneybird: MoneybirdPayload;
  exact: ExactPayload;
  meta: ExtractionMeta;
}

export interface ProcessOptions {
  bestandsnaam: string;
  /** Skip the API and use a pre-derived ideal extraction. */
  fixture?: ExtractedInvoice;
  mediaType?: string;
}

export async function processDocument(
  buffer: Buffer | null,
  opts: ProcessOptions
): Promise<ProcessResult> {
  let invoice: ExtractedInvoice;
  let meta: ExtractionMeta;
  let bron: "api" | "fixture";

  if (opts.fixture) {
    invoice = opts.fixture;
    bron = "fixture";
    meta = {
      model: "fixture",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      estimatedCostCents: 0,
    };
  } else {
    if (!buffer) throw new Error("Geen document en geen fixture opgegeven.");
    const result = await extractFromBuffer(buffer, opts.mediaType ?? "application/pdf");
    invoice = result.invoice;
    meta = result.meta;
    bron = "api";
  }

  const validatie = validateInvoice(invoice);
  const grootboek = classify(invoice);

  const redenen: Finding[] = [...validatie.findings];

  // An unclassified line is not a defect in the document, so it is not the
  // validator's business, but it does block unattended posting: we will not
  // guess at a grootboekrekening.
  if (grootboek.ongeclassificeerd > 0) {
    const namen = grootboek.regels
      .filter((r) => !r.account)
      .map((r) => `regel ${r.regel}`)
      .join(", ");
    redenen.push({
      code: "LEDGER_UNMAPPED",
      severity: "error",
      field: "grootboek",
      message: `Geen grootboekrekening bekend voor ${namen}. Koppel deze eenmalig aan de leverancier; daarna gaat het vanzelf.`,
    });
  }

  const beslissing: Beslissing = redenen.some((r) => r.severity === "error")
    ? "review"
    : "auto_post";

  return {
    bestandsnaam: opts.bestandsnaam,
    bron,
    invoice,
    validatie,
    grootboek,
    beslissing,
    redenen,
    moneybird: toMoneybird(invoice, grootboek, DEMO_MONEYBIRD_MAPPING),
    exact: toExactOnline(invoice, grootboek, DEMO_EXACT_MAPPING),
    meta,
  };
}

export { estimateCostCents };
