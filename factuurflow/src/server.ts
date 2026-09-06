import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPdf } from "./pdf.js";
import { renderInvoice } from "./invoice-render.js";
import { buildSamples, type Sample } from "./samples.js";
import { fixtureFor } from "./fixtures.js";
import { processDocument } from "./pipeline.js";
import { MODEL } from "./extract.js";

/**
 * The demo server.
 *
 * No framework and no build step: the whole thing is one node process serving
 * one page, so it can be handed to a prospect as `npm start` and run on their
 * own laptop with their own invoices, which is the only version of this demo
 * that ever closes anything.
 *
 * Sample PDFs are rendered on demand rather than read from disk so that a fresh
 * clone works with nothing generated.
 */

const PORT = Number(process.env["PORT"] ?? 4000);
const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const samples = new Map<string, Sample>(buildSamples().map((s) => [s.id, s]));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const route = url.pathname;

  if (route === "/api/status") {
    return json(res, 200, {
      liveExtraction: Boolean(process.env["ANTHROPIC_API_KEY"]),
      model: MODEL,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  }

  if (route === "/api/samples") {
    return json(
      res,
      200,
      [...samples.values()].map((s) => ({
        id: s.id,
        bestandsnaam: s.bestandsnaam,
        leverancier: s.groundTruth.leverancier,
        factuurnummer: s.groundTruth.factuurnummer,
        totaalIncl: s.groundTruth.totaalIncl,
        verwacht: s.groundTruth.verwachteBeslissing,
        waarom: s.groundTruth.waaromInteressant,
      }))
    );
  }

  const pdfMatch = /^\/api\/samples\/([\w-]+)\.pdf$/.exec(route);
  if (pdfMatch) {
    const sample = samples.get(pdfMatch[1] ?? "");
    if (!sample) return json(res, 404, { error: "Onbekend voorbeeld" });
    const pdf = buildPdf([renderInvoice(sample.spec)]);
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": pdf.length,
      "content-disposition": `inline; filename="${sample.bestandsnaam}"`,
      "cache-control": "no-store",
    });
    res.end(pdf);
    return;
  }

  if (route === "/api/process" && req.method === "POST") {
    const body = await readJson(req);
    return processRequest(res, body);
  }

  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  // Static files. The path is resolved and then checked to still sit inside
  // PUBLIC_DIR, so "../" in a request cannot walk out of it.
  const requested = route === "/" ? "index.html" : route.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== PUBLIC_DIR) {
    return json(res, 403, { error: "Verboden" });
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(file);
  } catch {
    json(res, 404, { error: "Niet gevonden" });
  }
}

async function processRequest(res: ServerResponse, body: unknown): Promise<void> {
  const req = (body ?? {}) as { sample?: string; bestand?: string; bestandsnaam?: string; mediaType?: string };

  if (req.sample) {
    const sample = samples.get(req.sample);
    if (!sample) return json(res, 404, { error: "Onbekend voorbeeld" });

    const live = Boolean(process.env["ANTHROPIC_API_KEY"]);
    const buffer = live ? buildPdf([renderInvoice(sample.spec)]) : null;

    const result = await processDocument(buffer, {
      bestandsnaam: sample.bestandsnaam,
      ...(live ? {} : { fixture: fixtureFor(sample) }),
    });
    return json(res, 200, { ...result, groundTruth: sample.groundTruth });
  }

  if (req.bestand) {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      return json(res, 400, {
        error:
          "Voor het verwerken van een eigen document is een ANTHROPIC_API_KEY nodig. De voorbeelden werken zonder sleutel.",
      });
    }
    const buffer = Buffer.from(req.bestand, "base64");
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return json(res, 413, { error: "Bestand is te groot voor de demo (max 12 MB)." });
    }
    const result = await processDocument(buffer, {
      bestandsnaam: req.bestandsnaam ?? "upload.pdf",
      mediaType: req.mediaType ?? "application/pdf",
    });
    return json(res, 200, result);
  }

  return json(res, 400, { error: "Geef een voorbeeld of een bestand op." });
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Base64 inflates by a third, plus JSON overhead.
      if (size > MAX_UPLOAD_BYTES * 1.4) {
        reject(new Error("Verzoek te groot"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

server.listen(PORT, () => {
  const mode = process.env["ANTHROPIC_API_KEY"]
    ? `live extractie via ${MODEL}`
    : "opgeslagen extracties (geen ANTHROPIC_API_KEY gevonden)";
  console.log(`FactuurFlow demo draait op http://localhost:${PORT}  —  ${mode}`);
});
