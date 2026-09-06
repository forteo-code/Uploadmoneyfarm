import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { INVOICE_TOOL_SCHEMA, normalize, type ExtractedInvoice } from "./schema.js";

/**
 * Extraction: document in, structured invoice out.
 *
 * Deliberately thin. Everything that can be decided by arithmetic lives in
 * validate.ts, so the model is only ever asked to *read* the document, never to
 * judge whether it adds up. That split is what makes unattended posting
 * defensible: the probabilistic step is confined to transcription.
 */

export const MODEL = process.env["FACTUURFLOW_MODEL"] ?? "claude-opus-5";

const TOOL_NAME = "leg_factuur_vast";

const SYSTEM_PROMPT = `Je bent een nauwkeurige factuurverwerker voor een Nederlands administratiekantoor.

Je krijgt één document. Lees het volledig en leg de gegevens vast met de tool ${TOOL_NAME}.

Harde regels:
- Neem bedragen exact over zoals ze op het document staan, inclusief de scheidingstekens die er staan. Reken niets om en reken niets uit. Als er "1.234,56" staat, geef je "1.234,56".
- Verzin nooit een waarde. Staat een veld er niet op, laat het dan leeg ("").
- Neem alleen echte factuurregels op. Subtotalen, kortingsregels die al in het subtotaal verwerkt zijn, kopteksten en btw-regels zijn geen factuurregels.
- Een verzendkosten- of toeslagregel is wél een factuurregel.
- Datums zet je om naar YYYY-MM-DD. Let op de Nederlandse notatie: 03-04-2025 is 3 april 2025, niet 4 maart.
- De leverancier is de partij die de factuur stuurt en betaald wil worden. De klant is de ontvanger. Verwissel ze niet: kijk naar wie het IBAN en het btw-nummer bij "betaling" heeft staan.
- Is het document een creditnota, een bon of een aanmaning, zet document_type dan daarop, ook als het woord "factuur" ergens voorkomt.
- Zie je iets dat niet klopt of niet te lezen is, benoem het in opmerkingen. Pas de bedragen niet aan om het kloppend te maken.

Je oordeel over of de factuur klopt is niet gevraagd; dat wordt apart gecontroleerd. Lees alleen af wat er staat.`;

export interface ExtractionMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Cost in eurocents at the rate card in COST_PER_MTOK, for the ROI story. */
  estimatedCostCents: number;
}

export interface ExtractionResult {
  invoice: ExtractedInvoice;
  raw: unknown;
  meta: ExtractionMeta;
}

/**
 * Published list prices per million tokens, in US dollars, converted at a fixed
 * rate. Only used to put a number on the per-document cost in the demo; it is
 * not billing. Override both via env when the rate card moves.
 */
const COST_PER_MTOK = {
  input: Number(process.env["FACTUURFLOW_COST_IN"] ?? 5),
  output: Number(process.env["FACTUURFLOW_COST_OUT"] ?? 25),
  usdToEur: Number(process.env["FACTUURFLOW_USD_EUR"] ?? 0.92),
};

const MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function mediaTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const type = MEDIA_TYPES[ext];
  if (!type) {
    throw new Error(
      `Bestandstype ${ext || "(geen extensie)"} wordt niet ondersteund. Ondersteund: ${Object.keys(MEDIA_TYPES).join(", ")}`
    );
  }
  return type;
}

export function documentBlock(mediaType: string, base64: string): Anthropic.ContentBlockParam {
  if (mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
      data: base64,
    },
  };
}

export async function extractFromFile(filePath: string): Promise<ExtractionResult> {
  const buffer = await readFile(filePath);
  return extractFromBuffer(buffer, mediaTypeFor(filePath));
}

export async function extractFromBuffer(
  buffer: Buffer,
  mediaType: string
): Promise<ExtractionResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is niet gezet. Zet de sleutel, of draai de demo met --fixtures voor de opgeslagen extracties."
    );
  }

  const client = new Anthropic({ apiKey });
  const started = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8_000,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description:
          "Leg de gegevens van de aangeleverde factuur vast. Roep deze tool precies één keer aan.",
        input_schema: INVOICE_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    // Forcing the tool is what makes the response shape guaranteed. Without it
    // the model will occasionally answer in prose for a document it considers
    // unreadable, and we would rather have a filled-in "onbekend" record that
    // the validator can reject on its own terms.
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          documentBlock(mediaType, buffer.toString("base64")),
          {
            type: "text",
            text: "Lees dit document en leg de factuurgegevens vast met de tool.",
          },
        ],
      },
    ],
  });

  const durationMs = Date.now() - started;

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );
  if (!toolUse) {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    throw new Error(
      `Model gaf geen gestructureerd antwoord (stop_reason: ${response.stop_reason}).${text ? ` Tekst: ${text.slice(0, 500)}` : ""}`
    );
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  return {
    invoice: normalize(toolUse.input),
    raw: toolUse.input,
    meta: {
      model: response.model,
      inputTokens,
      outputTokens,
      durationMs,
      estimatedCostCents: estimateCostCents(inputTokens, outputTokens),
    },
  };
}

export function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * COST_PER_MTOK.input +
    (outputTokens / 1_000_000) * COST_PER_MTOK.output;
  return Math.round(usd * COST_PER_MTOK.usdToEur * 100 * 100) / 100;
}
