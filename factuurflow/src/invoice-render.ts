import { PdfPage, measure } from "./pdf.js";
import { formatEuro, type Cents } from "./money.js";

/**
 * Renders an invoice specification onto a page.
 *
 * Three layout variants, because a demo built on one template proves nothing:
 * the buyer's objection is always "yes, but our suppliers' invoices all look
 * different", and the answer has to be visible in the sample set.
 */

export interface RenderParty {
  naam: string;
  adres: string;
  postcode: string;
  plaats: string;
  land?: string;
  kvk?: string;
  btw?: string;
  iban?: string;
  email?: string;
  telefoon?: string;
}

export interface RenderLine {
  omschrijving: string;
  aantal: string;
  eenheid?: string;
  eenheidsprijs: Cents;
  bedrag: Cents;
  tarief: number;
}

export interface RenderBtwGroup {
  tarief: number;
  grondslag: Cents;
  bedrag: Cents;
}

export interface InvoiceSpec {
  variant: "modern" | "klassiek" | "compact";
  documentTitel: string;
  leverancier: RenderParty;
  klant: RenderParty;
  factuurnummer: string;
  factuurdatum: string;
  vervaldatum?: string;
  betalingstermijn?: string;
  referentie?: string;
  lines: RenderLine[];
  btwGroups: RenderBtwGroup[];
  subtotaal: Cents;
  totaalBtw: Cents;
  totaalIncl: Cents;
  voettekst?: string[];
  notitie?: string;
  valutaPrefix?: string;
}

const MARGIN = 48;
const RIGHT = 595.28 - MARGIN;

export function renderInvoice(spec: InvoiceSpec): PdfPage {
  const page = new PdfPage();
  const money = (c: Cents) =>
    spec.valutaPrefix ? `${spec.valutaPrefix} ${formatEuro(c).replace("€ ", "")}` : formatEuro(c);

  let y = spec.variant === "modern" ? renderModernHeader(page, spec) : renderPlainHeader(page, spec);

  y = renderAddresses(page, spec, y);
  y = renderMeta(page, spec, y);
  y = renderTable(page, spec, y, money);
  y = renderTotals(page, spec, y, money);
  renderFooter(page, spec, y);

  return page;
}

function renderModernHeader(page: PdfPage, spec: InvoiceSpec): number {
  page.rect(0, 0, 595.28, 88, 0.13);
  page.text(MARGIN, 42, spec.leverancier.naam, { size: 20, bold: true, gray: 1 });
  page.text(MARGIN, 62, [spec.leverancier.adres, `${spec.leverancier.postcode} ${spec.leverancier.plaats}`].join("  ·  "), {
    size: 8,
    gray: 0.85,
  });
  page.text(MARGIN, 74, [spec.leverancier.email, spec.leverancier.telefoon].filter(Boolean).join("  ·  "), {
    size: 8,
    gray: 0.85,
  });
  page.text(MARGIN, 50, spec.documentTitel.toUpperCase(), {
    size: 16,
    bold: true,
    gray: 1,
    align: "right",
    width: RIGHT - MARGIN,
  });
  return 128;
}

function renderPlainHeader(page: PdfPage, spec: InvoiceSpec): number {
  const compact = spec.variant === "compact";
  page.text(MARGIN, 60, spec.leverancier.naam, { size: compact ? 13 : 16, bold: true });
  page.text(MARGIN, 76, spec.leverancier.adres, { size: 8.5, gray: 0.35 });
  page.text(MARGIN, 88, `${spec.leverancier.postcode} ${spec.leverancier.plaats}`, {
    size: 8.5,
    gray: 0.35,
  });
  if (spec.leverancier.telefoon) {
    page.text(MARGIN, 100, `T ${spec.leverancier.telefoon}`, { size: 8.5, gray: 0.35 });
  }
  page.text(MARGIN, 60, spec.documentTitel, {
    size: compact ? 15 : 20,
    bold: true,
    align: "right",
    width: RIGHT - MARGIN,
  });
  page.line(MARGIN, 112, RIGHT, 112, 0.6);
  return 140;
}

function renderAddresses(page: PdfPage, spec: InvoiceSpec, y: number): number {
  page.text(MARGIN, y, "Factuuradres", { size: 7.5, bold: true, gray: 0.45 });
  let ay = y + 14;
  const klantLines = [
    spec.klant.naam,
    spec.klant.adres,
    `${spec.klant.postcode} ${spec.klant.plaats}`,
    spec.klant.land && spec.klant.land !== "NL" ? spec.klant.land : "",
  ].filter(Boolean);
  for (const line of klantLines) {
    page.text(MARGIN, ay, line, { size: 9.5 });
    ay += 13;
  }
  if (spec.klant.btw) {
    page.text(MARGIN, ay, `Btw-nr. ${spec.klant.btw}`, { size: 8.5, gray: 0.4 });
    ay += 13;
  }
  return Math.max(ay, y + 60);
}

function renderMeta(page: PdfPage, spec: InvoiceSpec, y: number): number {
  const rows: [string, string][] = [["Factuurnummer", spec.factuurnummer], ["Factuurdatum", spec.factuurdatum]];
  if (spec.vervaldatum) rows.push(["Vervaldatum", spec.vervaldatum]);
  if (spec.betalingstermijn) rows.push(["Betaling", spec.betalingstermijn]);
  if (spec.referentie) rows.push(["Uw referentie", spec.referentie]);

  // The metadata block sits to the right of the address block, so it starts
  // above the y the address block returned.
  const blockTop = y - 60;
  const labelX = 340;
  const valueX = 430;
  let my = blockTop;
  for (const [label, value] of rows) {
    page.text(labelX, my, label, { size: 8.5, gray: 0.45 });
    page.text(valueX, my, value, { size: 8.5, bold: label === "Factuurnummer", align: "right", width: RIGHT - valueX });
    my += 13;
  }
  return Math.max(y, my) + 22;
}

function renderTable(
  page: PdfPage,
  spec: InvoiceSpec,
  y: number,
  money: (c: Cents) => string
): number {
  const cols = {
    omschrijving: MARGIN,
    aantal: 330,
    prijs: 380,
    tarief: 462,
    bedrag: 500,
  };

  page.rect(MARGIN, y - 10, RIGHT - MARGIN, 20, 0.94);
  page.text(cols.omschrijving + 4, y + 4, "Omschrijving", { size: 8, bold: true, gray: 0.3 });
  page.text(cols.aantal, y + 4, "Aantal", { size: 8, bold: true, gray: 0.3, align: "right", width: 40 });
  page.text(cols.prijs, y + 4, "Prijs", { size: 8, bold: true, gray: 0.3, align: "right", width: 72 });
  page.text(cols.tarief, y + 4, "Btw", { size: 8, bold: true, gray: 0.3, align: "right", width: 30 });
  page.text(cols.bedrag, y + 4, "Bedrag", { size: 8, bold: true, gray: 0.3, align: "right", width: RIGHT - cols.bedrag - 4 });

  let ry = y + 26;
  for (const line of spec.lines) {
    const desc = truncate(line.omschrijving, 268, 9);
    page.text(cols.omschrijving + 4, ry, desc, { size: 9 });
    page.text(cols.aantal, ry, line.eenheid ? `${line.aantal} ${line.eenheid}` : line.aantal, {
      size: 9,
      align: "right",
      width: 40,
    });
    page.text(cols.prijs, ry, money(line.eenheidsprijs), { size: 9, align: "right", width: 72 });
    page.text(cols.tarief, ry, `${line.tarief}%`, { size: 9, align: "right", width: 30 });
    page.text(cols.bedrag, ry, money(line.bedrag), {
      size: 9,
      align: "right",
      width: RIGHT - cols.bedrag - 4,
    });
    ry += 17;
    page.line(MARGIN, ry - 6, RIGHT, ry - 6, 0.9);
  }
  return ry + 12;
}

function renderTotals(
  page: PdfPage,
  spec: InvoiceSpec,
  y: number,
  money: (c: Cents) => string
): number {
  const labelX = 350;
  const valueX = 470;
  const valueW = RIGHT - valueX;
  let ty = y;

  page.text(labelX, ty, "Subtotaal excl. btw", { size: 9, gray: 0.35 });
  page.text(valueX, ty, money(spec.subtotaal), { size: 9, align: "right", width: valueW });
  ty += 15;

  for (const g of spec.btwGroups) {
    page.text(labelX, ty, `Btw ${g.tarief}% over ${money(g.grondslag)}`, { size: 9, gray: 0.35 });
    page.text(valueX, ty, money(g.bedrag), { size: 9, align: "right", width: valueW });
    ty += 15;
  }

  page.line(labelX, ty - 5, RIGHT, ty - 5, 0.4);
  ty += 6;
  page.text(labelX, ty, "Totaal te betalen", { size: 10.5, bold: true });
  page.text(valueX, ty, money(spec.totaalIncl), { size: 10.5, bold: true, align: "right", width: valueW });
  return ty + 30;
}

function renderFooter(page: PdfPage, spec: InvoiceSpec, y: number): void {
  let fy = Math.max(y, 700);

  if (spec.notitie) {
    page.text(MARGIN, fy, spec.notitie, { size: 8.5, gray: 0.2 });
    fy += 18;
  }

  const sup = spec.leverancier;
  const footer = [
    sup.iban ? `IBAN ${sup.iban}` : "",
    sup.kvk ? `KvK ${sup.kvk}` : "",
    sup.btw ? `Btw-nr. ${sup.btw}` : "",
  ].filter(Boolean);

  page.line(MARGIN, 762, RIGHT, 762, 0.85);
  page.text(MARGIN, 776, footer.join("   |   "), { size: 7.5, gray: 0.4 });
  for (const [i, extra] of (spec.voettekst ?? []).entries()) {
    page.text(MARGIN, 788 + i * 11, extra, { size: 7.5, gray: 0.4 });
  }
}

function truncate(text: string, maxWidth: number, size: number): string {
  if (measure(text, size, false) <= maxWidth) return text;
  let out = text;
  while (out.length > 4 && measure(`${out}...`, size, false) > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
}
