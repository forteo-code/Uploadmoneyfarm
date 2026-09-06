import { z } from "zod";

/**
 * The shape we ask the model for, and the shape we validate.
 *
 * Every monetary field arrives as a *string* exactly as printed on the
 * document. We do the parsing ourselves in money.ts so that a locale quirk
 * ("1.234,56") is a parsing decision we can see and test, not something the
 * model silently guessed at.
 *
 * Every field that can be absent is nullable rather than optional: we want the
 * model to positively say "this invoice has no order reference" instead of
 * quietly dropping the key, because a dropped key and an absent field are
 * indistinguishable downstream.
 */

const nullableString = z.string().min(1).nullable();

export const PartyZ = z.object({
  naam: z.string().min(1),
  adres: nullableString,
  postcode: nullableString,
  plaats: nullableString,
  land: nullableString,
  kvk_nummer: nullableString,
  btw_nummer: nullableString,
  iban: nullableString,
});

export const LineZ = z.object({
  omschrijving: z.string().min(1),
  aantal: nullableString,
  eenheidsprijs: nullableString,
  bedrag_excl_btw: z.string(),
  btw_percentage: z.string(),
});

export const BtwGroupZ = z.object({
  btw_percentage: z.string(),
  grondslag: z.string(),
  btw_bedrag: z.string(),
});

export const ExtractedInvoiceZ = z.object({
  document_type: z.enum(["factuur", "creditnota", "bon", "aanmaning", "onbekend"]),
  leverancier: PartyZ,
  klant: PartyZ.nullable(),
  factuurnummer: nullableString,
  factuurdatum: nullableString,
  vervaldatum: nullableString,
  betalingstermijn_dagen: z.number().int().nullable(),
  order_referentie: nullableString,
  valuta: z.string().min(3).max(3),
  regels: z.array(LineZ),
  btw_specificatie: z.array(BtwGroupZ),
  subtotaal_excl_btw: z.string(),
  totaal_btw: z.string(),
  totaal_incl_btw: z.string(),
  btw_verlegd: z.boolean(),
  opmerkingen: nullableString,
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceZ>;
export type Party = z.infer<typeof PartyZ>;
export type Line = z.infer<typeof LineZ>;
export type BtwGroup = z.infer<typeof BtwGroupZ>;

/**
 * JSON Schema handed to the API as the input schema of a single forced tool.
 *
 * Forced tool-use rather than a response-format parameter: it is supported by
 * every SDK and model revision we might get deployed against, and it fails
 * loudly (no tool_use block) instead of degrading into prose.
 *
 * Absent values are the empty string, never a null and never a missing key.
 * Union types (`["string","null"]`) are rejected by strict tool schemas, and an
 * omitted key is indistinguishable from a field the model failed to read, so
 * "" is the one representation that survives both constraints. normalize()
 * turns it back into null before anything else touches the data.
 */
export const INVOICE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "document_type",
    "leverancier",
    "klant",
    "factuurnummer",
    "factuurdatum",
    "vervaldatum",
    "betalingstermijn_dagen",
    "order_referentie",
    "valuta",
    "regels",
    "btw_specificatie",
    "subtotaal_excl_btw",
    "totaal_btw",
    "totaal_incl_btw",
    "btw_verlegd",
    "opmerkingen",
  ],
  properties: {
    document_type: {
      type: "string",
      enum: ["factuur", "creditnota", "bon", "aanmaning", "onbekend"],
      description: "Soort document.",
    },
    leverancier: party("De partij die de factuur stuurt (de crediteur)."),
    klant: party("De partij die de factuur ontvangt. Alle velden leeg indien niet vermeld."),
    factuurnummer: str("Factuurnummer exact zoals afgedrukt, inclusief prefix."),
    factuurdatum: str("Factuurdatum als ISO-datum YYYY-MM-DD."),
    vervaldatum: str("Vervaldatum als ISO-datum YYYY-MM-DD, indien vermeld."),
    betalingstermijn_dagen: str("Betalingstermijn in dagen als geheel getal, bv. '30'."),
    order_referentie: str("Order-, PO- of referentienummer van de klant."),
    valuta: str("ISO 4217 valutacode, bv. EUR."),
    regels: {
      type: "array",
      description:
        "Elke echte factuurregel, in de volgorde waarin ze op de factuur staan. Neem geen subtotalen, kopteksten of btw-regels op.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["omschrijving", "aantal", "eenheidsprijs", "bedrag_excl_btw", "btw_percentage"],
        properties: {
          omschrijving: str("Omschrijving van de regel."),
          aantal: str("Aantal zoals afgedrukt."),
          eenheidsprijs: str("Prijs per eenheid exclusief btw, exact zoals afgedrukt."),
          bedrag_excl_btw: str("Regelbedrag exclusief btw, exact zoals afgedrukt."),
          btw_percentage: str("Btw-percentage voor deze regel als getal zonder %, bv. '21'."),
        },
      },
    },
    btw_specificatie: {
      type: "array",
      description:
        "De btw-uitsplitsing per tarief zoals onderaan de factuur vermeld. Leeg laten als de factuur geen uitsplitsing toont.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["btw_percentage", "grondslag", "btw_bedrag"],
        properties: {
          btw_percentage: str("Tarief als getal zonder %, bv. '21'."),
          grondslag: str("Bedrag waarover de btw berekend is."),
          btw_bedrag: str("Het btw-bedrag voor dit tarief."),
        },
      },
    },
    subtotaal_excl_btw: str("Totaal exclusief btw, exact zoals afgedrukt."),
    totaal_btw: str("Totaal btw-bedrag, exact zoals afgedrukt."),
    totaal_incl_btw: str("Eindtotaal inclusief btw, exact zoals afgedrukt."),
    btw_verlegd: {
      type: "boolean",
      description: "True als de factuur 'btw verlegd' of 'reverse charge' vermeldt.",
    },
    opmerkingen: str(
      "Alles wat een boekhouder moet weten: onleesbare velden, tegenstrijdigheden, bijzondere betalingsvoorwaarden. Leeg als er niets bijzonders is."
    ),
  },
} as const;

function str(description: string) {
  return { type: "string", description: `${description} Leeg laten ("") als dit niet op het document staat.` } as const;
}

function party(description: string) {
  return {
    type: "object",
    description,
    additionalProperties: false,
    required: ["naam", "adres", "postcode", "plaats", "land", "kvk_nummer", "btw_nummer", "iban"],
    properties: {
      naam: str("Bedrijfsnaam."),
      adres: str("Straat en huisnummer."),
      postcode: str("Postcode zoals afgedrukt."),
      plaats: str("Plaatsnaam."),
      land: str("Land als ISO-landcode van twee letters."),
      kvk_nummer: str("KvK-nummer, alleen de cijfers."),
      btw_nummer: str("Btw-identificatienummer, bv. NL123456789B01."),
      iban: str("IBAN zonder spaties."),
    },
  } as const;
}

/**
 * Turns the model's raw tool input into a validated ExtractedInvoice.
 *
 * Throws a ZodError with a usable path when the model returns something that
 * does not fit — which we want to surface as a hard failure rather than paper
 * over, because a malformed extraction is not a low-confidence extraction.
 */
export function normalize(raw: unknown): ExtractedInvoice {
  const blank = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" || t === "-" || t.toLowerCase() === "n.v.t." ? null : t;
  };

  const asRecord = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  const r = asRecord(raw);

  const normParty = (v: unknown) => {
    const p = asRecord(v);
    return {
      naam: typeof p["naam"] === "string" ? p["naam"].trim() : "",
      adres: blank(p["adres"]),
      postcode: blank(p["postcode"]),
      plaats: blank(p["plaats"]),
      land: blank(p["land"]),
      kvk_nummer: blank(p["kvk_nummer"]),
      btw_nummer: blank(p["btw_nummer"]),
      iban: blank(p["iban"]),
    };
  };

  const klant = normParty(r["klant"]);
  const termijn = blank(r["betalingstermijn_dagen"]);
  const termijnNum = termijn === null ? null : Number.parseInt(termijn, 10);

  const candidate = {
    document_type: r["document_type"] ?? "onbekend",
    leverancier: normParty(r["leverancier"]),
    klant: klant.naam === "" ? null : klant,
    factuurnummer: blank(r["factuurnummer"]),
    factuurdatum: blank(r["factuurdatum"]),
    vervaldatum: blank(r["vervaldatum"]),
    betalingstermijn_dagen: Number.isFinite(termijnNum) ? termijnNum : null,
    order_referentie: blank(r["order_referentie"]),
    valuta: (blank(r["valuta"]) ?? "EUR").toUpperCase().slice(0, 3),
    regels: (Array.isArray(r["regels"]) ? r["regels"] : []).map((v) => {
      const l = asRecord(v);
      return {
        omschrijving: typeof l["omschrijving"] === "string" ? l["omschrijving"].trim() : "",
        aantal: blank(l["aantal"]),
        eenheidsprijs: blank(l["eenheidsprijs"]),
        bedrag_excl_btw: typeof l["bedrag_excl_btw"] === "string" ? l["bedrag_excl_btw"] : "",
        btw_percentage: typeof l["btw_percentage"] === "string" ? l["btw_percentage"] : "",
      };
    }),
    btw_specificatie: (Array.isArray(r["btw_specificatie"]) ? r["btw_specificatie"] : [])
      .map((v) => {
        const g = asRecord(v);
        return {
          btw_percentage: typeof g["btw_percentage"] === "string" ? g["btw_percentage"] : "",
          grondslag: typeof g["grondslag"] === "string" ? g["grondslag"] : "",
          btw_bedrag: typeof g["btw_bedrag"] === "string" ? g["btw_bedrag"] : "",
        };
      })
      // A model sometimes emits an empty placeholder group; it carries no
      // information and would only trip the "unparseable group" check.
      .filter((g) => g.btw_percentage !== "" || g.grondslag !== "" || g.btw_bedrag !== ""),
    subtotaal_excl_btw: typeof r["subtotaal_excl_btw"] === "string" ? r["subtotaal_excl_btw"] : "",
    totaal_btw: typeof r["totaal_btw"] === "string" ? r["totaal_btw"] : "",
    totaal_incl_btw: typeof r["totaal_incl_btw"] === "string" ? r["totaal_incl_btw"] : "",
    btw_verlegd: r["btw_verlegd"] === true,
    opmerkingen: blank(r["opmerkingen"]),
  };

  return ExtractedInvoiceZ.parse(candidate);
}
