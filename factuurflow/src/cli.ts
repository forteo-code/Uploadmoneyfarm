import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractFromBuffer, mediaTypeFor, MODEL } from "./extract.js";
import { processDocument, type ProcessResult } from "./pipeline.js";
import { buildSamples } from "./samples.js";
import { fixtureFor } from "./fixtures.js";
import { formatEuro } from "./money.js";

/**
 * Command line entry point.
 *
 *   factuurflow <bestand.pdf>     verwerk één document
 *   factuurflow --samples         verwerk de hele voorbeeldset
 *   factuurflow --map <map>       verwerk elk document in een map
 *
 * With --samples and no API key it runs the stored extractions, which exercises
 * everything except the model. With a key it runs live and scores the result
 * against the manifest, which is the only number worth quoting to a prospect.
 */

interface Options {
  targets: string[];
  samples: boolean;
  directory: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { targets: [], samples: false, directory: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--samples") opts.samples = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--map" || arg === "--dir") opts.directory = argv[++i] ?? null;
    else if (arg && !arg.startsWith("--")) opts.targets.push(arg);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const live = Boolean(process.env["ANTHROPIC_API_KEY"]);

  if (opts.samples) return runSamples(live, opts.json);

  const files = opts.directory
    ? (await readdir(opts.directory))
        .filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f))
        .map((f) => path.join(opts.directory!, f))
    : opts.targets;

  if (files.length === 0) {
    console.error("Gebruik: factuurflow <bestand.pdf> | --samples | --map <map>");
    process.exitCode = 1;
    return;
  }

  if (!live) {
    console.error("ANTHROPIC_API_KEY is niet gezet; eigen documenten kunnen niet gelezen worden.");
    console.error("Draai `npm run extract -- --samples` voor de voorbeeldset zonder sleutel.");
    process.exitCode = 1;
    return;
  }

  const results: ProcessResult[] = [];
  for (const file of files) {
    const buffer = await readFile(file);
    const result = await processDocument(buffer, {
      bestandsnaam: path.basename(file),
      mediaType: mediaTypeFor(file),
    });
    results.push(result);
    if (!opts.json) report(result);
  }

  if (opts.json) console.log(JSON.stringify(results, null, 2));
  else summarise(results);
}

async function runSamples(live: boolean, asJson: boolean): Promise<void> {
  const samples = buildSamples();
  const results: ProcessResult[] = [];
  let decisionsCorrect = 0;
  let totalsCorrect = 0;

  console.error(
    live
      ? `Live extractie via ${MODEL} over ${samples.length} voorbeelden.\n`
      : `Geen ANTHROPIC_API_KEY: opgeslagen extracties over ${samples.length} voorbeelden.\n`
  );

  for (const sample of samples) {
    let result: ProcessResult;
    if (live) {
      const { buildPdf } = await import("./pdf.js");
      const { renderInvoice } = await import("./invoice-render.js");
      const pdf = buildPdf([renderInvoice(sample.spec)]);
      const extracted = await extractFromBuffer(pdf, "application/pdf");
      result = await processDocument(null, {
        bestandsnaam: sample.bestandsnaam,
        fixture: extracted.invoice,
      });
      result.meta = extracted.meta;
      result.bron = "api";
    } else {
      result = await processDocument(null, {
        bestandsnaam: sample.bestandsnaam,
        fixture: fixtureFor(sample),
      });
    }

    results.push(result);

    const gt = sample.groundTruth;
    const decisionOk = result.beslissing === gt.verwachteBeslissing;
    const totalOk = result.validatie.totals.totaalIncl === gt.totaalIncl;
    if (decisionOk) decisionsCorrect++;
    if (totalOk) totalsCorrect++;

    if (!asJson) {
      const mark = decisionOk && totalOk ? "ok  " : "FOUT";
      console.log(
        `${mark} ${sample.bestandsnaam.padEnd(38)} ${result.beslissing.padEnd(10)} ` +
          `${formatEuro(result.validatie.totals.totaalIncl ?? 0).padStart(13)}` +
          (decisionOk ? "" : `  (verwacht ${gt.verwachteBeslissing})`) +
          (totalOk ? "" : `  (verwacht ${formatEuro(gt.totaalIncl)})`)
      );
      for (const reason of result.redenen) {
        console.log(`     ${reason.severity.padEnd(7)} ${reason.code}: ${reason.message}`);
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(
    `\nBeslissing correct: ${decisionsCorrect}/${samples.length}   ` +
      `Eindtotaal correct: ${totalsCorrect}/${samples.length}`
  );
  if (!live) {
    console.log(
      "Let op: dit draaide op opgeslagen extracties. Dit meet de controles en de boeking, niet de leesnauwkeurigheid."
    );
  }
  summarise(results);
}

function report(result: ProcessResult): void {
  const inv = result.invoice;
  console.log(`\n${result.bestandsnaam}`);
  console.log(`  ${inv.leverancier.naam}  ${inv.factuurnummer ?? "(geen nummer)"}  ${inv.factuurdatum ?? "?"}`);
  console.log(
    `  ${formatEuro(result.validatie.totals.subtotaalExcl ?? 0)} excl  +  ` +
      `${formatEuro(result.validatie.totals.totaalBtw ?? 0)} btw  =  ` +
      `${formatEuro(result.validatie.totals.totaalIncl ?? 0)}`
  );
  console.log(`  ${result.beslissing === "auto_post" ? "wordt geboekt" : "naar controle"}`);
  for (const reason of result.redenen) {
    console.log(`    ${reason.severity.padEnd(7)} ${reason.code}: ${reason.message}`);
    if (reason.expected || reason.found) {
      console.log(`             verwacht ${reason.expected ?? "-"}  gevonden ${reason.found ?? "-"}`);
    }
  }
}

function summarise(results: ProcessResult[]): void {
  const auto = results.filter((r) => r.beslissing === "auto_post").length;
  const cost = results.reduce((s, r) => s + r.meta.estimatedCostCents, 0);
  const seconds = results.reduce((s, r) => s + r.meta.durationMs, 0) / 1000;

  console.log(
    `\n${results.length} documenten · ${auto} automatisch geboekt · ${results.length - auto} naar controle`
  );
  if (cost > 0) {
    console.log(
      `Verwerkingstijd ${seconds.toFixed(1)} s · geschatte modelkosten ${cost.toFixed(1)} eurocent ` +
        `(${(cost / results.length).toFixed(2)} cent per document)`
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
