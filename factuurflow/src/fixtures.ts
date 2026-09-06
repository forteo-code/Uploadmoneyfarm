import { formatEuro, type Cents } from "./money.js";
import { normalize, type ExtractedInvoice } from "./schema.js";
import { buildSamples, type Sample } from "./samples.js";

/**
 * Offline extractions for the sample set.
 *
 * These are derived mechanically from the same specifications the PDFs are
 * rendered from, which makes them an *ideal* read: exactly what a perfect
 * transcription of the document would produce. They exist so the validator,
 * the ledger rules, the mappings and the whole demo can be run and tested with
 * no API key and no network.
 *
 * They are not evidence of extraction accuracy, and nothing here should ever be
 * presented as such. Accuracy is what `npm run extract -- --all` measures
 * against the manifest with a real key.
 */

/** An amount exactly as the renderer prints it, minus the currency symbol. */
function printed(cents: Cents): string {
  return formatEuro(cents).replace("€ ", "").replace("-€ ", "-");
}

export function fixtureFor(sample: Sample): ExtractedInvoice {
  const s = sample.spec;
  const party = (p: {
    naam: string; adres: string; postcode: string; plaats: string;
    land?: string; kvk?: string; btw?: string; iban?: string;
  }) => ({
    naam: p.naam,
    adres: p.adres,
    postcode: p.postcode,
    plaats: p.plaats,
    land: p.land ?? "",
    kvk_nummer: p.kvk ?? "",
    btw_nummer: p.btw ?? "",
    iban: p.iban ?? "",
  });

  const documentType =
    s.documentTitel.toLowerCase().includes("credit")
      ? "creditnota"
      : s.documentTitel.toLowerCase() === "bon"
        ? "bon"
        : "factuur";

  const verlegd =
    (s.notitie ?? "").toLowerCase().includes("verlegd") ||
    (s.notitie ?? "").toLowerCase().includes("reverse charge");

  const termijn = /(\d+)\s*dagen/i.exec(s.betalingstermijn ?? "")?.[1] ?? "";

  return normalize({
    document_type: documentType,
    leverancier: party(s.leverancier),
    klant: party(s.klant),
    factuurnummer: s.factuurnummer,
    factuurdatum: s.factuurdatum,
    vervaldatum: s.vervaldatum ?? "",
    betalingstermijn_dagen: termijn,
    order_referentie: s.referentie ?? "",
    valuta: s.valutaPrefix ?? "EUR",
    regels: s.lines.map((l) => ({
      omschrijving: l.omschrijving,
      aantal: l.aantal,
      eenheidsprijs: printed(l.eenheidsprijs),
      bedrag_excl_btw: printed(l.bedrag),
      btw_percentage: String(l.tarief),
    })),
    btw_specificatie: s.btwGroups.map((g) => ({
      btw_percentage: String(g.tarief),
      grondslag: printed(g.grondslag),
      btw_bedrag: printed(g.bedrag),
    })),
    subtotaal_excl_btw: printed(s.subtotaal),
    totaal_btw: printed(s.totaalBtw),
    totaal_incl_btw: printed(s.totaalIncl),
    btw_verlegd: verlegd,
    opmerkingen: s.notitie ?? "",
  });
}

export function allFixtures(): Map<string, { sample: Sample; invoice: ExtractedInvoice }> {
  const out = new Map<string, { sample: Sample; invoice: ExtractedInvoice }>();
  for (const sample of buildSamples()) {
    out.set(sample.bestandsnaam, { sample, invoice: fixtureFor(sample) });
    out.set(sample.id, { sample, invoice: fixtureFor(sample) });
  }
  return out;
}
