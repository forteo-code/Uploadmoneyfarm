# FactuurFlow

Inkomende facturen automatisch lezen, controleren en klaarzetten voor Moneybird of
Exact Online.

Het verschil met de tientallen andere OCR-tools zit niet in het lezen. Lezen kan
iedereen. Het zit erin dat er **niets geboekt wordt wat niet klopt**: elk document
gaat door een set deterministische controles — telt de factuur op, klopt de btw per
tarief, is het IBAN echt, is het btw-nummer geldig, liggen de datums in de goede
volgorde — en alleen wat daar heelhuids doorheen komt gaat automatisch de
administratie in. De rest komt op een stapel met de reden erbij.

Dat onderscheid is het hele product. Een tool die 97% goed leest en de andere 3%
stilletjes verkeerd boekt, kost een administratiekantoor meer dan hij oplevert.

## Snel draaien

```bash
npm install
npm run build
npm test              # 31 tests, geen API-sleutel nodig
npm run samples       # schrijft 9 voorbeeld-PDF's naar samples/
node dist/server.js   # demo op http://localhost:4000
```

De demo werkt volledig zonder `ANTHROPIC_API_KEY`: de voorbeeldfacturen draaien dan
op opgeslagen extracties. Met een sleutel in de omgeving worden diezelfde PDF's
live gelezen en kun je in de demo ook je eigen factuur uploaden.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node dist/cli.js --samples          # live lezen, score tegen de manifest
node dist/cli.js factuur.pdf        # één eigen document
node dist/cli.js --map ~/facturen   # een hele map
```

## Wat er gebeurt met een document

1. **Lezen** — `src/extract.ts`. Eén model-aanroep met een afgedwongen tool, zodat het
   antwoord altijd de goede vorm heeft. Het model wordt uitsluitend gevraagd om over
   te tikken wat er staat: bedragen exact zoals afgedrukt, niets omrekenen, niets
   verzinnen, ontbrekende velden leeg laten.
2. **Normaliseren** — `src/schema.ts`, `src/money.ts`. Lege strings worden nulls,
   bedragen worden hele centen. `1.234,56`, `1,234.56` en `1.234,56-` gaan alle drie
   naar het juiste getal; wat dubbelzinnig is wordt geweigerd in plaats van geraden.
3. **Controleren** — `src/validate.ts`. Geen model, alleen rekenwerk en checksums.
   Zie hieronder.
4. **Rubriceren** — `src/ledger.ts`. Regels naar grootboekrekeningen via
   leesbare trefwoordregels, met een vaste koppeling per leverancier die daar
   overheen gaat.
5. **Boeken** — `src/accounting.ts`. Een payload in de vorm die Moneybird
   (`purchase_invoices`) respectievelijk Exact Online (`PurchaseEntries`) verwacht.

## De controles

| Controle | Wat het vindt |
| --- | --- |
| Regels tellen op tot subtotaal | Een regel die de leverancier vergat mee te tellen, of een verkeerd gelezen bedrag |
| Btw per tarief over de grondslag | Een rekenfout in het sjabloon van de leverancier |
| Grondslagen tellen op tot subtotaal | Een btw-uitsplitsing die niet bij de factuur hoort |
| Subtotaal + btw = eindtotaal | De klassieke overtikfout |
| Aantal × prijs = regelbedrag | Een verkeerd gelezen aantal |
| IBAN mod-97 | Een gemanipuleerd rekeningnummer — het patroon van factuurfraude |
| Btw-nummer formaat en 11-proef | Een verzonnen of verkeerd gelezen btw-nummer |
| Verlegd zonder btw | Een verleggingsfactuur die tóch btw in rekening brengt |
| Datumlogica | Vervaldatum vóór factuurdatum, een datum die niet bestaat, een factuur uit 2019 |
| Verplichte velden | Geen factuurnummer, geen datum, geen leverancier |
| Grootboekrekening bekend | Een regel die we niet kunnen rubriceren — wordt niet geraden |

Alles wat een `error` oplevert blokkeert automatisch boeken. Een `warning` gaat door
maar wordt getoond.

Rekentolerantie is één cent per regel, met een ondergrens van twee cent. Leveranciers
berekenen btw per regel, per tarief of over het totaal, en die drie verschillen op een
lange factuur een cent of twee. Een echte fout — een omgewisseld cijfer, een gemiste
regel — is altijd groter.

## De voorbeeldset

Negen documenten, van vijf verschillende opmaaksjablonen. Vijf zijn schoon en gaan
automatisch door. Vier bevatten een specifieke, realistische fout:

| Document | Wat er mis is |
| --- | --- |
| `05-rekenfout-drukkerij.pdf` | 21% over de grondslag is €10 meer dan het vermelde btw-bedrag |
| `06-iban-advocaten.pdf` | IBAN faalt op mod-97, en de factuur meldt zelf "gewijzigd rekeningnummer" |
| `08-bon-tankstation.pdf` | Kassabon zonder factuurnummer |
| `09-ontbrekende-regel-schoonmaak.pdf` | Een regel staat op de factuur maar niet in het subtotaal |

`samples/manifest.json` bevat per document de verwachte uitkomst. Dat is waar
`--samples` tegenaan scoort.

Alle bedrijven, adressen, KvK-nummers, btw-nummers en IBAN's in de voorbeelden zijn
verzonnen. Ze hebben de vorm van echte Nederlandse identifiers zodat de controles
hun echte codepaden aflopen, maar ze horen bij niemand.

## Wat dit nog niet is

Eerlijk, omdat het uitmaakt bij wat je erover zegt:

- **De leesnauwkeurigheid is niet gemeten.** De testsuite draait op opgeslagen
  extracties: perfecte transcripties, mechanisch afgeleid uit dezelfde specificatie
  waar de PDF's uit gerenderd worden. Die bewijzen dat de controles, de rubricering
  en de boeking kloppen. Ze bewijzen niets over hoe goed het model leest. Daarvoor is
  een `ANTHROPIC_API_KEY` nodig en `node dist/cli.js --samples`.
- **Er wordt niets echt geboekt.** De payloads zijn compleet en in de juiste vorm,
  maar er is nog geen OAuth-koppeling en dus geen `POST` naar een echte administratie.
  Dat is bewust: koppelen aan iemands boekhouding is de stap waar credentials en
  onomkeerbare acties bij komen kijken, en die hoort pas gebouwd te worden voor een
  klant die getekend heeft.
- **Er is geen e-mail-inbox.** Het binnenhalen van facturen uit een mailbox is
  ongeveer een dag werk en staat pas op de rol als er een klant is die er een heeft.
- **Er zit geen scan van een gefotografeerde, gekreukte bon in de voorbeeldset.**
  Alle voorbeelden zijn digitaal gerenderde PDF's. Dat is de makkelijke helft van de
  werkelijkheid.

## Bestanden

```
src/money.ts            bedragen als hele centen, en het parsen van wat er afgedrukt staat
src/schema.ts           het toolschema, en het normaliseren van wat het model teruggeeft
src/extract.ts          de model-aanroep
src/validate.ts         alle deterministische controles
src/ledger.ts           grootboekrubricering
src/accounting.ts       Moneybird- en Exact Online-payloads
src/pipeline.ts         het geheel, van document tot boekingsbesluit
src/pdf.ts              een minimale PDF-schrijver
src/invoice-render.ts   de opmaak van de voorbeeldfacturen
src/samples.ts          de voorbeeldset met verwachte uitkomsten
src/fixtures.ts         opgeslagen extracties, voor draaien zonder sleutel
src/server.ts           de demoserver
src/cli.ts              de opdrachtregel
public/                 de demo-interface
```
