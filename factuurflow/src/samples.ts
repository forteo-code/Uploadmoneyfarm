import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPdf } from "./pdf.js";
import { renderInvoice, type InvoiceSpec, type RenderLine } from "./invoice-render.js";
import { nlBtw, nlIban } from "./id.js";
import { btwOver, type Cents } from "./money.js";

/**
 * The sample set.
 *
 * These are the documents the demo runs on, and they are chosen to answer the
 * only two questions a prospect actually asks: "does it read our suppliers'
 * invoices" and "what happens when something is wrong". Half the set is clean
 * and should post unattended; half contains a specific, realistic defect and
 * must be routed to review with the reason named.
 *
 * Every organisation and number here is invented. They are shaped like real
 * Dutch identifiers so the validator exercises its real code paths, and they
 * belong to no one.
 */

export interface SampleGroundTruth {
  factuurnummer: string | null;
  factuurdatum: string | null;
  leverancier: string;
  totaalIncl: Cents;
  subtotaal: Cents;
  totaalBtw: Cents;
  regels: number;
  verwachteBeslissing: "auto_post" | "review";
  /** Finding codes we expect the validator to raise, if any. */
  verwachteCodes: string[];
  waaromInteressant: string;
}

export interface Sample {
  id: string;
  bestandsnaam: string;
  spec: InvoiceSpec;
  groundTruth: SampleGroundTruth;
}

/** Builds a line, deriving the line amount from quantity and unit price. */
function line(
  omschrijving: string,
  aantal: number,
  eenheidsprijs: Cents,
  tarief: number,
  eenheid?: string
): RenderLine {
  return {
    omschrijving,
    aantal: Number.isInteger(aantal) ? String(aantal) : aantal.toFixed(2).replace(".", ","),
    ...(eenheid !== undefined ? { eenheid } : {}),
    eenheidsprijs,
    bedrag: Math.round(aantal * eenheidsprijs),
    tarief,
  };
}

/** Groups lines by rate and computes the BTW block the way a correct ERP would. */
function totalsFor(lines: RenderLine[]) {
  const byRate = new Map<number, Cents>();
  for (const l of lines) byRate.set(l.tarief, (byRate.get(l.tarief) ?? 0) + l.bedrag);

  const btwGroups = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([tarief, grondslag]) => ({ tarief, grondslag, bedrag: btwOver(grondslag, tarief * 100) }));

  const subtotaal = lines.reduce((s, l) => s + l.bedrag, 0);
  const totaalBtw = btwGroups.reduce((s, g) => s + g.bedrag, 0);
  return { btwGroups, subtotaal, totaalBtw, totaalIncl: subtotaal + totaalBtw };
}

const HOSTING = {
  naam: "Nordwijk Cloud Services B.V.",
  adres: "Kanaalweg 112",
  postcode: "3526 KL",
  plaats: "Utrecht",
  land: "NL",
  kvk: "62481907",
  btw: nlBtw("62481907"),
  iban: nlIban("RABO", "0148920371"),
  email: "facturatie@nordwijkcloud.example",
  telefoon: "030 - 250 41 88",
};

const KLANT = {
  naam: "De Boer & Vermeulen Advies B.V.",
  adres: "Weteringschans 87",
  postcode: "1017 RZ",
  plaats: "Amsterdam",
  land: "NL",
  btw: nlBtw("81725409"),
};

export function buildSamples(): Sample[] {
  const samples: Sample[] = [];

  /* 1. Clean SaaS invoice, single rate, modern layout. The baseline. */
  {
    const lines = [
      line("Managed hosting - productieomgeving (mrt 2026)", 1, 89_500, 21),
      line("Back-upopslag 500 GB", 5, 4_200, 21, "st"),
      line("SSL-certificaat wildcard, jaarlijks", 1, 12_900, 21),
      line("Support-uren buiten contract", 3.5, 11_000, 21, "uur"),
    ];
    const t = totalsFor(lines);
    samples.push({
      id: "01-hosting",
      bestandsnaam: "01-hosting-nordwijk.pdf",
      spec: {
        variant: "modern",
        documentTitel: "Factuur",
        leverancier: HOSTING,
        klant: KLANT,
        factuurnummer: "2026-0417",
        factuurdatum: "2026-03-31",
        vervaldatum: "2026-04-30",
        betalingstermijn: "30 dagen netto",
        referentie: "PO-2026-114",
        lines,
        ...t,
        voettekst: ["Gelieve bij betaling het factuurnummer te vermelden."],
      },
      groundTruth: {
        factuurnummer: "2026-0417",
        factuurdatum: "2026-03-31",
        leverancier: HOSTING.naam,
        totaalIncl: t.totaalIncl,
        subtotaal: t.subtotaal,
        totaalBtw: t.totaalBtw,
        regels: lines.length,
        verwachteBeslissing: "auto_post",
        verwachteCodes: [],
        waaromInteressant:
          "Schone factuur, één tarief, fractioneel aantal (3,5 uur). Dit is de basislijn: hier moet niets op aan te merken zijn.",
      },
    });
  }

  /* 2. Mixed 9% and 21%, classic layout. Catches rate-per-line handling. */
  {
    const lines = [
      line("Lunchbuffet 24 personen", 24, 1_450, 9, "pers"),
      line("Koffie en thee, hele dag", 24, 375, 9, "pers"),
      line("Zaalhuur vergaderruimte De Werf", 1, 32_500, 21),
      line("Beamer en scherm", 1, 7_500, 21),
      line("Bediening, 2 medewerkers", 8, 3_250, 21, "uur"),
    ];
    const t = totalsFor(lines);
    samples.push({
      id: "02-catering",
      bestandsnaam: "02-catering-vandermeer.pdf",
      spec: {
        variant: "klassiek",
        documentTitel: "FACTUUR",
        leverancier: {
          naam: "Van der Meer Zalenverhuur & Catering",
          adres: "Havenstraat 4",
          postcode: "2011 VP",
          plaats: "Haarlem",
          land: "NL",
          kvk: "34209815",
          btw: nlBtw("34209815"),
          iban: nlIban("INGB", "0006734512"),
          telefoon: "023 - 531 20 04",
        },
        klant: KLANT,
        factuurnummer: "VDM-26-0882",
        factuurdatum: "2026-02-18",
        vervaldatum: "2026-03-04",
        betalingstermijn: "14 dagen",
        referentie: "Teamdag 17 februari",
        lines,
        ...t,
      },
      groundTruth: {
        factuurnummer: "VDM-26-0882",
        factuurdatum: "2026-02-18",
        leverancier: "Van der Meer Zalenverhuur & Catering",
        totaalIncl: t.totaalIncl,
        subtotaal: t.subtotaal,
        totaalBtw: t.totaalBtw,
        regels: lines.length,
        verwachteBeslissing: "auto_post",
        verwachteCodes: [],
        waaromInteressant:
          "Twee btw-tarieven op één factuur. De uitsplitsing moet per tarief kloppen, niet alleen in totaal.",
      },
    });
  }

  /* 3. Credit note. Negative amounts, and the type must not be read as an invoice. */
  {
    const lines = [
      line("Retour: Managed hosting maart 2026 (dubbel gefactureerd)", 1, -89_500, 21),
    ];
    const t = totalsFor(lines);
    samples.push({
      id: "03-creditnota",
      bestandsnaam: "03-creditnota-nordwijk.pdf",
      spec: {
        variant: "modern",
        documentTitel: "Creditnota",
        leverancier: HOSTING,
        klant: KLANT,
        factuurnummer: "2026-0433C",
        factuurdatum: "2026-04-08",
        betalingstermijn: "Verrekening met openstaand saldo",
        referentie: "Correctie op factuur 2026-0417",
        lines,
        ...t,
        notitie: "Dit bedrag wordt verrekend met de eerstvolgende factuur.",
      },
      groundTruth: {
        factuurnummer: "2026-0433C",
        factuurdatum: "2026-04-08",
        leverancier: HOSTING.naam,
        totaalIncl: t.totaalIncl,
        subtotaal: t.subtotaal,
        totaalBtw: t.totaalBtw,
        regels: lines.length,
        verwachteBeslissing: "auto_post",
        verwachteCodes: [],
        waaromInteressant:
          "Creditnota met negatieve bedragen. Als het documenttype fout gelezen wordt, wordt er geld dubbel geboekt in plaats van teruggeboekt.",
      },
    });
  }

  /* 4. Reverse charge. BTW must be zero and the type must be recognised. */
  {
    const lines = [
      line("Aanleg elektra begane grond, week 6-8", 96, 4_850, 0, "uur"),
      line("Materiaal volgens specificatie bijlage A", 1, 274_310, 0),
    ];
    const subtotaal = lines.reduce((s, l) => s + l.bedrag, 0);
    samples.push({
      id: "04-verlegd",
      bestandsnaam: "04-verlegd-installatie.pdf",
      spec: {
        variant: "klassiek",
        documentTitel: "FACTUUR",
        leverancier: {
          naam: "Kuipers Installatietechniek B.V.",
          adres: "Ambachtsweg 33",
          postcode: "7442 CS",
          plaats: "Nijverdal",
          land: "NL",
          kvk: "08174962",
          btw: nlBtw("08174962"),
          iban: nlIban("ABNA", "0417164300"),
          telefoon: "0548 - 61 22 90",
        },
        klant: {
          naam: "Bouwcombinatie Randstad V.O.F.",
          adres: "Industrieweg 210",
          postcode: "2544 EX",
          plaats: "Den Haag",
          land: "NL",
          btw: nlBtw("55013829"),
        },
        factuurnummer: "F26-0311",
        factuurdatum: "2026-02-27",
        vervaldatum: "2026-03-29",
        betalingstermijn: "30 dagen",
        referentie: "Project Waalhaven fase 2",
        lines,
        btwGroups: [],
        subtotaal,
        totaalBtw: 0,
        totaalIncl: subtotaal,
        notitie: "Btw verlegd naar de afnemer op grond van artikel 12 lid 5 Wet OB 1968.",
        voettekst: ["Werkzaamheden verricht in onderaanneming."],
      },
      groundTruth: {
        factuurnummer: "F26-0311",
        factuurdatum: "2026-02-27",
        leverancier: "Kuipers Installatietechniek B.V.",
        totaalIncl: subtotaal,
        subtotaal,
        totaalBtw: 0,
        regels: lines.length,
        verwachteBeslissing: "auto_post",
        verwachteCodes: [],
        waaromInteressant:
          "Btw verlegd in de bouw. Als dit als een gewone 0%-factuur geboekt wordt, klopt de btw-aangifte niet.",
      },
    });
  }

  /* 5. Arithmetic error in the BTW block. The supplier's own template is wrong. */
  {
    const lines = [
      line("Drukwerk brochures, full colour, 135 grams", 2_500, 84, 21, "st"),
      line("Opmaak en DTP", 6, 8_500, 21, "uur"),
      line("Verzending en distributie", 1, 14_750, 21),
    ];
    const t = totalsFor(lines);
    // The BTW group is short by €10,00: the classic result of a supplier's
    // template applying the rate to a stale base after a late line change.
    const brokenBtw = t.totaalBtw - 1_000;
    samples.push({
      id: "05-rekenfout",
      bestandsnaam: "05-rekenfout-drukkerij.pdf",
      spec: {
        variant: "compact",
        documentTitel: "Factuur",
        leverancier: {
          naam: "Drukkerij Hendriksen v.o.f.",
          adres: "Nijverheidsplein 8",
          postcode: "6541 CT",
          plaats: "Nijmegen",
          land: "NL",
          kvk: "10047723",
          btw: nlBtw("10047723"),
          iban: nlIban("TRIO", "0198765432"),
          telefoon: "024 - 377 14 05",
        },
        klant: KLANT,
        factuurnummer: "24815",
        factuurdatum: "2026-01-22",
        vervaldatum: "2026-02-21",
        betalingstermijn: "30 dagen",
        lines,
        btwGroups: [{ tarief: 21, grondslag: t.subtotaal, bedrag: brokenBtw }],
        subtotaal: t.subtotaal,
        totaalBtw: brokenBtw,
        totaalIncl: t.subtotaal + brokenBtw,
      },
      groundTruth: {
        factuurnummer: "24815",
        factuurdatum: "2026-01-22",
        leverancier: "Drukkerij Hendriksen v.o.f.",
        totaalIncl: t.subtotaal + brokenBtw,
        subtotaal: t.subtotaal,
        totaalBtw: brokenBtw,
        regels: lines.length,
        verwachteBeslissing: "review",
        verwachteCodes: ["BTW_GROUP_ARITHMETIC"],
        waaromInteressant:
          "21% over de grondslag komt niet uit op het vermelde btw-bedrag. Een mens die alleen het eindtotaal overtikt, ziet dit nooit.",
      },
    });
  }

  /* 6. IBAN with a broken checksum: the invoice-fraud signature. */
  {
    const lines = [
      line("Juridisch advies, dossier 2026/114", 14, 27_500, 21, "uur"),
      line("Griffierecht (doorbelast, onbelast)", 1, 68_800, 0),
    ];
    const t = totalsFor(lines);
    const goodIban = nlIban("ABNA", "0512334455");
    // Flip two digits in the account number without recomputing the check digits.
    const badIban = `${goodIban.slice(0, 10)}9${goodIban.slice(11)}`;
    samples.push({
      id: "06-iban",
      bestandsnaam: "06-iban-advocaten.pdf",
      spec: {
        variant: "klassiek",
        documentTitel: "FACTUUR",
        leverancier: {
          naam: "Wesselink & Partners Advocaten",
          adres: "Parkstraat 19",
          postcode: "2514 JD",
          plaats: "Den Haag",
          land: "NL",
          kvk: "27185503",
          btw: nlBtw("27185503"),
          iban: badIban,
          telefoon: "070 - 361 88 40",
        },
        klant: KLANT,
        factuurnummer: "WP-2026-0071",
        factuurdatum: "2026-03-12",
        vervaldatum: "2026-03-26",
        betalingstermijn: "14 dagen",
        lines,
        ...t,
        voettekst: ["Let op: gewijzigd rekeningnummer per 1 maart."],
      },
      groundTruth: {
        factuurnummer: "WP-2026-0071",
        factuurdatum: "2026-03-12",
        leverancier: "Wesselink & Partners Advocaten",
        totaalIncl: t.totaalIncl,
        subtotaal: t.subtotaal,
        totaalBtw: t.totaalBtw,
        regels: lines.length,
        verwachteBeslissing: "review",
        verwachteCodes: ["IBAN_CHECKSUM_FAILED"],
        waaromInteressant:
          "Het rekeningnummer voldoet niet aan de mod-97 controle, en de factuur zegt er zelf bij dat het rekeningnummer gewijzigd is. Dit is precies het patroon van factuurfraude.",
      },
    });
  }

  /* 7. Foreign supplier, GBP, no NL identifiers. */
  {
    const lines = [
      line("Annual licence - Analytics Platform, 25 seats", 25, 18_000, 0, "st"),
      line("Onboarding and configuration", 1, 95_000, 0),
    ];
    const subtotaal = lines.reduce((s, l) => s + l.bedrag, 0);
    samples.push({
      id: "07-gbp",
      bestandsnaam: "07-buitenland-gbp.pdf",
      spec: {
        variant: "modern",
        documentTitel: "Invoice",
        leverancier: {
          naam: "Thornbury Analytics Ltd",
          adres: "48 Bridge Road",
          postcode: "BS1 4TR",
          plaats: "Bristol",
          land: "GB",
          kvk: "",
          btw: "GB428193756",
          iban: "GB29NWBK60161331926819",
          email: "billing@thornburyanalytics.example",
        },
        klant: KLANT,
        factuurnummer: "TA-9931",
        factuurdatum: "2026-03-05",
        vervaldatum: "2026-04-04",
        betalingstermijn: "Net 30",
        lines,
        btwGroups: [],
        subtotaal,
        totaalBtw: 0,
        totaalIncl: subtotaal,
        valutaPrefix: "GBP",
        notitie: "VAT reverse charge - customer to account for VAT.",
      },
      groundTruth: {
        factuurnummer: "TA-9931",
        factuurdatum: "2026-03-05",
        leverancier: "Thornbury Analytics Ltd",
        totaalIncl: subtotaal,
        subtotaal,
        totaalBtw: 0,
        regels: lines.length,
        verwachteBeslissing: "auto_post",
        verwachteCodes: ["NON_EUR_CURRENCY"],
        waaromInteressant:
          "Buitenlandse leverancier, vreemde valuta, geen KvK en geen Nederlandse postcode. Mag door, maar niet zonder wisselkoers.",
      },
    });
  }

  /* 8. A receipt with no invoice number. Legally not a valid invoice. */
  {
    const lines = [
      line("Euro 95 E10", 46.12, 199, 21, "L"),
      line("Ruitensproeier antivries 1L", 1, 699, 21, "st"),
    ];
    const t = totalsFor(lines);
    samples.push({
      id: "08-bon",
      bestandsnaam: "08-bon-tankstation.pdf",
      spec: {
        variant: "compact",
        documentTitel: "Bon",
        leverancier: {
          naam: "Tankstation De Rotonde",
          adres: "Provincialeweg 2",
          postcode: "4854 PB",
          plaats: "Bavel",
          land: "NL",
          kvk: "20117864",
          btw: nlBtw("20117864"),
          iban: nlIban("RABO", "0301946725"),
        },
        klant: { naam: "", adres: "", postcode: "", plaats: "" },
        factuurnummer: "",
        factuurdatum: "2026-03-19",
        lines,
        ...t,
        notitie: "Pin - transactie 004182 - terminal 3",
      },
      groundTruth: {
        factuurnummer: null,
        factuurdatum: "2026-03-19",
        leverancier: "Tankstation De Rotonde",
        totaalIncl: t.totaalIncl,
        subtotaal: t.subtotaal,
        totaalBtw: t.totaalBtw,
        regels: lines.length,
        verwachteBeslissing: "review",
        verwachteCodes: ["MISSING_INVOICE_NUMBER"],
        waaromInteressant:
          "Een kassabon zonder factuurnummer. Boekbaar als kostenpost, maar niet als factuur waarop btw teruggevraagd wordt zonder tussenkomst.",
      },
    });
  }

  /* 9. A line missing from the printed subtotal. */
  {
    const lines = [
      line("Schoonmaak kantoorpand, februari", 1, 148_000, 21),
      line("Glasbewassing buitenzijde", 1, 34_500, 21),
      line("Sanitaire voorzieningen aanvulling", 1, 21_750, 21),
    ];
    // The supplier's template dropped the third line from the subtotal.
    const brokenSubtotaal = lines[0]!.bedrag + lines[1]!.bedrag;
    const brokenBtw = btwOver(brokenSubtotaal, 2100);
    samples.push({
      id: "09-ontbrekende-regel",
      bestandsnaam: "09-ontbrekende-regel-schoonmaak.pdf",
      spec: {
        variant: "klassiek",
        documentTitel: "FACTUUR",
        leverancier: {
          naam: "Helder Schoonmaakdiensten B.V.",
          adres: "Zilverzijde 41",
          postcode: "3543 CE",
          plaats: "Utrecht",
          land: "NL",
          kvk: "30188442",
          btw: nlBtw("30188442"),
          iban: nlIban("INGB", "0002345678"),
          telefoon: "030 - 241 77 12",
        },
        klant: KLANT,
        factuurnummer: "HS-2026-0204",
        factuurdatum: "2026-03-01",
        vervaldatum: "2026-03-31",
        betalingstermijn: "30 dagen",
        lines,
        btwGroups: [{ tarief: 21, grondslag: brokenSubtotaal, bedrag: brokenBtw }],
        subtotaal: brokenSubtotaal,
        totaalBtw: brokenBtw,
        totaalIncl: brokenSubtotaal + brokenBtw,
      },
      groundTruth: {
        factuurnummer: "HS-2026-0204",
        factuurdatum: "2026-03-01",
        leverancier: "Helder Schoonmaakdiensten B.V.",
        totaalIncl: brokenSubtotaal + brokenBtw,
        subtotaal: brokenSubtotaal,
        totaalBtw: brokenBtw,
        regels: lines.length,
        verwachteBeslissing: "review",
        verwachteCodes: ["LINES_DO_NOT_SUM_TO_SUBTOTAL"],
        waaromInteressant:
          "Er staat een regel op de factuur die niet in het subtotaal zit. De factuur is intern consistent op elk ander punt, dus alleen het optellen van de regels vindt dit.",
      },
    });
  }

  return samples;
}

export async function writeSamples(outDir: string): Promise<Sample[]> {
  await mkdir(outDir, { recursive: true });
  const samples = buildSamples();

  for (const sample of samples) {
    const pdf = buildPdf([renderInvoice(sample.spec)]);
    await writeFile(path.join(outDir, sample.bestandsnaam), pdf);
  }

  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(
      samples.map((s) => ({ id: s.id, bestandsnaam: s.bestandsnaam, ...s.groundTruth })),
      null,
      2
    )}\n`
  );

  return samples;
}

if (process.argv[1] && process.argv[1].endsWith("samples.js")) {
  const outDir = process.argv[2] ?? path.resolve("samples");
  writeSamples(outDir)
    .then((samples) => {
      for (const s of samples) console.log(`${s.bestandsnaam.padEnd(38)} ${s.groundTruth.verwachteBeslissing}`);
      console.log(`\n${samples.length} voorbeeldfacturen geschreven naar ${outDir}`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
