import type { ExtractedInvoice, Line } from "./schema.js";

/**
 * Rule-based classification of invoice lines onto grootboekrekeningen.
 *
 * Deliberately not a model call. A bookkeeper's chart of accounts is stable and
 * small, the mapping is the same every month for the same supplier, and a rule
 * that can be read and edited by the client's own accountant is worth more here
 * than a classifier that is right slightly more often but cannot be argued
 * with. The escape hatch is the supplier override: once a supplier is booked,
 * that mapping wins over any keyword.
 */

export interface LedgerAccount {
  code: string;
  naam: string;
}

export interface LedgerRule {
  account: LedgerAccount;
  /** Matched case-insensitively against the line description. */
  trefwoorden: string[];
}

/**
 * A conventional Dutch SME chart of accounts. Codes follow the 4xxx cost /
 * 7xxx purchase convention most Nederlandse administratiekantoren use; a client
 * with their own scheme replaces this table wholesale.
 */
export const DEFAULT_RULES: LedgerRule[] = [
  {
    account: { code: "4800", naam: "Automatiseringskosten" },
    trefwoorden: [
      "hosting", "server", "cloud", "licentie", "licence", "license", "software",
      "saas", "abonnement", "domein", "domain", "ssl", "certificaat", "back-up",
      "backup", "opslag", "storage", "seats", "platform", "api", "support-uren",
    ],
  },
  {
    account: { code: "4300", naam: "Huisvestingskosten" },
    trefwoorden: [
      "huur", "zaalhuur", "schoonmaak", "glasbewassing", "sanitair", "energie",
      "elektra", "gas ", "water", "onderhoud pand", "servicekosten", "beveiliging",
      // Equipment that comes with a hired room is billed on the same invoice and
      // belongs on the same account as the room.
      "beamer", "scherm", "geluidsinstallatie", "vergaderruimte",
    ],
  },
  {
    account: { code: "4400", naam: "Kantoorkosten" },
    trefwoorden: [
      "kantoorartikelen", "papier", "printer", "toner", "porto", "postzegel",
      "telefoon", "internet", "abonnement telefonie",
    ],
  },
  {
    account: { code: "4510", naam: "Brandstof en autokosten" },
    trefwoorden: [
      "euro 95", "diesel", "benzine", "brandstof", "tanken", "laadpaal", "adblue",
      "wegenwacht", "parkeren", "leasetermijn", "ruitensproeier", "antivries",
    ],
  },
  {
    account: { code: "4600", naam: "Verkoop- en reclamekosten" },
    trefwoorden: [
      "drukwerk", "brochure", "flyer", "advertentie", "reclame", "marketing",
      "dtp", "opmaak", "beursstand", "relatiegeschenk", "distributie",
    ],
  },
  {
    account: { code: "4630", naam: "Representatiekosten" },
    trefwoorden: [
      "lunch", "diner", "catering", "buffet", "koffie", "thee", "borrel",
      "bediening", "consumpties",
    ],
  },
  {
    account: { code: "4710", naam: "Accountants- en advieskosten" },
    trefwoorden: [
      "advies", "advocaat", "juridisch", "notaris", "accountant", "boekhouding",
      "aangifte", "griffierecht", "consultancy", "onboarding", "configuratie",
    ],
  },
  {
    account: { code: "7000", naam: "Inkoopwaarde van de omzet" },
    trefwoorden: [
      "materiaal", "onderaanneming", "inkoop", "grondstoffen", "installatie",
      "aanleg", "montage", "werkzaamheden",
    ],
  },
  {
    account: { code: "4900", naam: "Overige algemene kosten" },
    trefwoorden: ["verzendkosten", "verzending", "administratiekosten", "toeslag", "transport"],
  },
];

export interface LineClassification {
  regel: number;
  omschrijving: string;
  account: LedgerAccount | null;
  bron: "leverancier" | "trefwoord" | "geen";
  trefwoord?: string;
}

export interface LedgerResult {
  regels: LineClassification[];
  /** The account to book the whole invoice on when every line agrees. */
  hoofdrekening: LedgerAccount | null;
  ongeclassificeerd: number;
}

/**
 * Per-supplier overrides, keyed by a normalised supplier name.
 *
 * In production this is a table the client edits; here it is seeded with the
 * two sample suppliers whose descriptions are ambiguous on keywords alone.
 */
export type SupplierOverrides = Record<string, LedgerAccount>;

export const DEFAULT_OVERRIDES: SupplierOverrides = {
  "kuipers installatietechniek bv": { code: "7000", naam: "Inkoopwaarde van de omzet" },
  "thornbury analytics ltd": { code: "4800", naam: "Automatiseringskosten" },
};

export function normaliseSupplier(naam: string): string {
  return naam
    .toLowerCase()
    .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|n\.?v\.?|ltd|gmbh|inc)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, " ");
}

export function classify(
  invoice: ExtractedInvoice,
  rules: LedgerRule[] = DEFAULT_RULES,
  overrides: SupplierOverrides = DEFAULT_OVERRIDES
): LedgerResult {
  const supplierKey = normaliseSupplier(invoice.leverancier.naam).replace(/\s+/g, " ");
  const override =
    overrides[supplierKey] ??
    overrides[supplierKey.replace(/\s/g, "")] ??
    Object.entries(overrides).find(([k]) => normaliseSupplier(k) === supplierKey)?.[1];

  const regels: LineClassification[] = invoice.regels.map((line, i) => {
    if (override) {
      return { regel: i + 1, omschrijving: line.omschrijving, account: override, bron: "leverancier" };
    }
    const hit = matchRule(line, rules);
    if (hit) {
      return {
        regel: i + 1,
        omschrijving: line.omschrijving,
        account: hit.account,
        bron: "trefwoord",
        trefwoord: hit.trefwoord,
      };
    }
    return { regel: i + 1, omschrijving: line.omschrijving, account: null, bron: "geen" };
  });

  const codes = new Set(regels.map((r) => r.account?.code).filter(Boolean));
  const first = regels.find((r) => r.account)?.account ?? null;

  return {
    regels,
    hoofdrekening: codes.size === 1 ? first : null,
    ongeclassificeerd: regels.filter((r) => !r.account).length,
  };
}

function matchRule(
  line: Line,
  rules: LedgerRule[]
): { account: LedgerAccount; trefwoord: string } | null {
  const haystack = line.omschrijving.toLowerCase();
  let best: { account: LedgerAccount; trefwoord: string } | null = null;

  for (const rule of rules) {
    for (const woord of rule.trefwoorden) {
      if (!haystack.includes(woord)) continue;
      // Longest keyword wins: "support-uren" should beat "uren", and a rule that
      // matches a full phrase is a stronger signal than one matching a fragment.
      if (!best || woord.length > best.trefwoord.length) {
        best = { account: rule.account, trefwoord: woord };
      }
    }
  }
  return best;
}
