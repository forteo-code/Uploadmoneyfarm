/**
 * A minimal PDF writer, just enough to lay out an invoice.
 *
 * Written by hand rather than pulled in as a dependency: the samples only need
 * positioned text, rules and filled rectangles, and a self-contained generator
 * means the demo can be rebuilt on any machine with nothing but node.
 *
 * Text is encoded as WinAnsi (CP1252), which covers the accented characters and
 * the euro sign a Dutch invoice actually uses.
 */

export type Align = "left" | "right" | "center";

export interface TextOptions {
  size?: number;
  bold?: boolean;
  align?: Align;
  /** Width of the box the text is aligned within; required for right/center. */
  width?: number;
  gray?: number;
}

interface Op {
  kind: "text" | "rect" | "line";
  data: string;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

/** CP1252 positions for the characters above ASCII that we care about. */
const WINANSI_EXTRA: Record<string, number> = {
  "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84, "\u2026": 0x85,
  "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88, "\u2030": 0x89, "\u0160": 0x8a,
  "\u2039": 0x8b, "\u0152": 0x8c, "\u017D": 0x8e, "\u2018": 0x91, "\u2019": 0x92,
  "\u201C": 0x93, "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203A": 0x9b, "\u0153": 0x9c,
  "\u017E": 0x9e, "\u0178": 0x9f,
};

/**
 * Helvetica advance widths in 1/1000 em, for the ASCII range.
 *
 * Only used to right-align and centre text. Approximate widths would make the
 * amount column visibly ragged, which is exactly the detail that makes a demo
 * document look fake.
 */
const HELV_WIDTHS: Record<string, number> = buildWidths(
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
  [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
   556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
   1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
   667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
   333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
   556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
);

const HELV_BOLD_WIDTHS: Record<string, number> = buildWidths(
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
  [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
   556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
   975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
   667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
   333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
   611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]
);

function buildWidths(chars: string, widths: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const w = widths[i];
    if (ch !== undefined && w !== undefined) out[ch] = w;
  }
  return out;
}

export function measure(text: string, size: number, bold: boolean): number {
  const table = bold ? HELV_BOLD_WIDTHS : HELV_WIDTHS;
  let total = 0;
  for (const ch of text) total += table[ch] ?? 556;
  return (total * size) / 1000;
}

export class PdfPage {
  private ops: Op[] = [];

  readonly width = A4_WIDTH;
  readonly height = A4_HEIGHT;

  text(x: number, y: number, value: string, opts: TextOptions = {}): void {
    const size = opts.size ?? 9;
    const bold = opts.bold ?? false;
    const align = opts.align ?? "left";

    let drawX = x;
    if (align !== "left") {
      const boxWidth = opts.width ?? 0;
      const textWidth = measure(value, size, bold);
      drawX = align === "right" ? x + boxWidth - textWidth : x + (boxWidth - textWidth) / 2;
    }

    const gray = opts.gray ?? 0;
    this.ops.push({
      kind: "text",
      data: `BT ${gray} g /${bold ? "FB" : "FR"} ${size} Tf 1 0 0 1 ${round(drawX)} ${round(this.height - y)} Tm (${escapeText(value)}) Tj ET 0 g`,
    });
  }

  rect(x: number, y: number, w: number, h: number, gray: number): void {
    this.ops.push({
      kind: "rect",
      data: `${gray} g ${round(x)} ${round(this.height - y - h)} ${round(w)} ${round(h)} re f 0 g`,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.75, width = 0.5): void {
    this.ops.push({
      kind: "line",
      data: `${gray} G ${width} w ${round(x1)} ${round(this.height - y1)} m ${round(x2)} ${round(this.height - y2)} l S 0 G`,
    });
  }

  content(): string {
    return this.ops.map((o) => o.data).join("\n");
  }
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function escapeText(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += `\\${ch}`;
    } else if (code < 128) {
      out += ch;
    } else {
      const winansi = WINANSI_EXTRA[ch] ?? (code <= 255 ? code : 63);
      out += `\\${winansi.toString(8).padStart(3, "0")}`;
    }
  }
  return out;
}

/**
 * Serialises pages into a single-file PDF with a correct xref table.
 *
 * Byte offsets in the xref must be exact or readers reject the file, so the
 * body is assembled as a Buffer and offsets are taken from its true length
 * rather than from the string length of the pieces.
 */
export function buildPdf(pages: PdfPage[]): Buffer {
  const objects: Buffer[] = [];
  const push = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return objects.length; // 1-based object number
  };

  // Object numbering is fixed up front so /Kids and /Parent can reference each
  // other: 1 = catalog, 2 = pages, 3..4 = fonts, then one content stream and
  // one page object per page.
  const catalogNo = 1;
  const pagesNo = 2;
  const fontRegularNo = 3;
  const fontBoldNo = 4;
  const firstPageNo = 5;

  const pageNos: number[] = [];
  for (let i = 0; i < pages.length; i++) pageNos.push(firstPageNo + i * 2);

  push(`<< /Type /Catalog /Pages ${pagesNo} 0 R >>`);
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageNos.map((n) => `${n} 0 R`).join(" ")}] >>`
  );
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  pages.forEach((page, i) => {
    const pageNo = firstPageNo + i * 2;
    const contentNo = pageNo + 1;
    push(
      `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] ` +
        `/Resources << /Font << /FR ${fontRegularNo} 0 R /FB ${fontBoldNo} 0 R >> >> ` +
        `/Contents ${contentNo} 0 R >>`
    );
    const stream = Buffer.from(page.content(), "latin1");
    push(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream", "latin1"),
      ])
    );
  });

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const chunks: Buffer[] = [header];
  const offsets: number[] = [];
  let offset = header.length;

  objects.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  });

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
}
