import assert from "node:assert/strict";
import test from "node:test";
import { parseAmount, formatEuro, btwOver } from "./money.js";
import { isValidIban, dutchBtwPassesElevenProef, btwNumberShape, parseRate, validateInvoice } from "./validate.js";
import { nlIban, nlBtw } from "./id.js";
import { normalize } from "./schema.js";
import { buildSamples } from "./samples.js";
import { fixtureFor } from "./fixtures.js";
import { processDocument } from "./pipeline.js";
import { classify, normaliseSupplier } from "./ledger.js";
import { buildPdf } from "./pdf.js";
import { renderInvoice } from "./invoice-render.js";
import { parseAmount as parse } from "./money.js";

test("parseAmount handles the notations a Dutch invoice actually uses", () => {
  const cases: Array<[string, number | null]> = [
    ["1.234,56", 123_456],
    ["1,234.56", 123_456],
    ["1234,56", 123_456],
    ["1234.56", 123_456],
    ["1234", 123_400],
    ["€ 1.234,56", 123_456],
    ["  12,00  ", 1_200],
    ["-12,00", -1_200],
    ["1.234,56-", -123_456],
    ["0,05", 5],
    ["1.000", 100_000],
    ["1.000.000,00", 100_000_000],
    ["9,9", 990],
    ["", null],
    ["n.v.t.", null],
    ["abc", null],
    ["1.2.3", null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseAmount(input), expected, `parseAmount(${JSON.stringify(input)})`);
  }
});

test("formatEuro round-trips through parseAmount", () => {
  for (const cents of [0, 1, 99, 100, 12_345, -12_345, 100_000_000]) {
    assert.equal(parse(formatEuro(cents)), cents, `round-trip ${cents}`);
  }
});

test("btwOver rounds half-up the way the Belastingdienst expects", () => {
  assert.equal(btwOver(10_000, 2100), 2_100);
  assert.equal(btwOver(161_900, 2100), 33_999);
  assert.equal(btwOver(3, 2100), 1); // 0.63 cents rounds to 1
  assert.equal(btwOver(1_000, 900), 90);
  assert.equal(btwOver(12_345, 0), 0);
});

test("IBAN mod-97 accepts valid and rejects tampered numbers", () => {
  const valid = nlIban("RABO", "0148920371");
  assert.ok(isValidIban(valid), `${valid} should be valid`);
  assert.ok(isValidIban("GB29NWBK60161331926819"));
  assert.ok(isValidIban("NL91 ABNA 0417 1643 00"));

  // Flip one digit of the body: the checksum must catch it.
  const tampered = `${valid.slice(0, 10)}${valid[10] === "9" ? "8" : "9"}${valid.slice(11)}`;
  assert.equal(isValidIban(tampered), false, `${tampered} should fail`);
  assert.equal(isValidIban("NL00RABO0148920371"), false);
  assert.equal(isValidIban("not an iban"), false);
});

test("Dutch btw numbers: format and 11-proef", () => {
  const btw = nlBtw("62481907");
  assert.equal(btwNumberShape(btw), "nl");
  assert.ok(dutchBtwPassesElevenProef(btw), `${btw} should pass the 11-proef`);
  assert.equal(btwNumberShape("GB428193756"), "eu");
  assert.equal(btwNumberShape("NL12345B01"), "invalid");
  assert.equal(btwNumberShape("XX123456789B01"), "invalid");
});

test("parseRate normalises to basis points", () => {
  assert.equal(parseRate("21"), 2100);
  assert.equal(parseRate("21%"), 2100);
  assert.equal(parseRate("9,0"), 900);
  assert.equal(parseRate("0"), 0);
  assert.equal(parseRate(""), null);
  assert.equal(parseRate("honderdtwintig"), null);
  assert.equal(parseRate("120"), null);
});

test("normalize turns empty strings into nulls and survives missing keys", () => {
  const inv = normalize({
    document_type: "factuur",
    leverancier: { naam: "Test B.V.", adres: "", postcode: "", plaats: "", land: "", kvk_nummer: "", btw_nummer: "", iban: "" },
    klant: { naam: "" },
    factuurnummer: "F-1",
    factuurdatum: "2026-01-01",
    subtotaal_excl_btw: "100,00",
    totaal_btw: "21,00",
    totaal_incl_btw: "121,00",
    regels: [{ omschrijving: "Iets", bedrag_excl_btw: "100,00", btw_percentage: "21" }],
    btw_verlegd: false,
  });
  assert.equal(inv.leverancier.iban, null);
  assert.equal(inv.klant, null);
  assert.equal(inv.vervaldatum, null);
  assert.equal(inv.valuta, "EUR");
  assert.equal(inv.regels.length, 1);
  assert.equal(inv.regels[0]?.aantal, null);
  assert.deepEqual(inv.btw_specificatie, []);
});

test("normalize rejects a shape it cannot repair", () => {
  assert.throws(() => normalize({ leverancier: { naam: "X" }, regels: [{ omschrijving: "" }] }));
});

test("validator catches a broken grand total", () => {
  const base = fixtureFor(buildSamples()[0]!);
  const broken = { ...base, totaal_incl_btw: "9.999,00" };
  const result = validateInvoice(broken);
  assert.equal(result.decision, "review");
  assert.ok(result.findings.some((f) => f.code === "GRAND_TOTAL_MISMATCH"), "expected GRAND_TOTAL_MISMATCH");
});

test("validator tolerates a one-cent rounding difference but not a ten-cent one", () => {
  const base = fixtureFor(buildSamples()[0]!);
  const nudged = { ...base, totaal_incl_btw: "1.958,98" };
  assert.equal(validateInvoice(nudged).decision, "auto_post");
  const wrong = { ...base, totaal_incl_btw: "1.958,49" };
  assert.equal(validateInvoice(wrong).decision, "review");
});

test("validator refuses a due date before the invoice date", () => {
  const base = fixtureFor(buildSamples()[0]!);
  const result = validateInvoice({ ...base, vervaldatum: "2026-01-01" });
  assert.ok(result.findings.some((f) => f.code === "DUE_BEFORE_INVOICE"));
});

test("validator rejects an impossible calendar date", () => {
  const base = fixtureFor(buildSamples()[0]!);
  const result = validateInvoice({ ...base, factuurdatum: "2026-02-30" });
  assert.ok(result.findings.some((f) => f.code === "INVOICE_DATE_UNPARSEABLE"));
});

test("validator flags reverse charge that still charges btw", () => {
  const base = fixtureFor(buildSamples()[3]!);
  const result = validateInvoice({ ...base, totaal_btw: "100,00" });
  assert.ok(result.findings.some((f) => f.code === "REVERSE_CHARGE_WITH_BTW"));
});

test("supplier normalisation strips legal forms", () => {
  assert.equal(normaliseSupplier("Kuipers Installatietechniek B.V."), "kuipers installatietechniek");
  assert.equal(normaliseSupplier("Drukkerij Hendriksen v.o.f."), "drukkerij hendriksen");
});

test("ledger classification assigns every line of the clean samples", () => {
  for (const sample of buildSamples()) {
    const result = classify(fixtureFor(sample));
    assert.equal(
      result.ongeclassificeerd,
      0,
      `${sample.id}: ${result.regels.filter((r) => !r.account).map((r) => r.omschrijving).join(" | ")}`
    );
  }
});

test("supplier override beats keyword matching", () => {
  const verlegd = fixtureFor(buildSamples()[3]!);
  const result = classify(verlegd);
  assert.ok(result.regels.every((r) => r.bron === "leverancier"));
  assert.equal(result.hoofdrekening?.code, "7000");
});

await test("every sample reaches the decision its ground truth expects", async (t) => {
  for (const sample of buildSamples()) {
    await t.test(sample.id, async () => {
      const result = await processDocument(null, {
        bestandsnaam: sample.bestandsnaam,
        fixture: fixtureFor(sample),
      });

      assert.equal(
        result.beslissing,
        sample.groundTruth.verwachteBeslissing,
        `${sample.id}: ${result.redenen.map((r) => `${r.severity}:${r.code}`).join(", ")}`
      );

      for (const code of sample.groundTruth.verwachteCodes) {
        assert.ok(
          result.redenen.some((r) => r.code === code),
          `${sample.id}: expected finding ${code}, got ${result.redenen.map((r) => r.code).join(", ") || "none"}`
        );
      }

      assert.equal(result.invoice.regels.length, sample.groundTruth.regels);
      assert.equal(result.validatie.totals.totaalIncl, sample.groundTruth.totaalIncl);
      assert.equal(result.validatie.totals.subtotaalExcl, sample.groundTruth.subtotaal);
      assert.equal(result.validatie.totals.totaalBtw, sample.groundTruth.totaalBtw);
    });
  }
});

await test("Moneybird payload line values sum back to the validated subtotal", async () => {
  for (const sample of buildSamples()) {
    const result = await processDocument(null, {
      bestandsnaam: sample.bestandsnaam,
      fixture: fixtureFor(sample),
    });
    const sum = result.moneybird.purchase_invoice.details_attributes.reduce(
      (acc, d) => acc + Math.round(Number(d.price) * 100),
      0
    );
    const lineSum = result.validatie.totals.regelsSom;
    assert.equal(sum, lineSum, `${sample.id}: payload ${sum} vs lines ${lineSum}`);
  }
});

await test("Moneybird payload carries a tax rate for every line", async () => {
  for (const sample of buildSamples()) {
    const result = await processDocument(null, {
      bestandsnaam: sample.bestandsnaam,
      fixture: fixtureFor(sample),
    });
    for (const d of result.moneybird.purchase_invoice.details_attributes) {
      assert.ok(d.tax_rate_id, `${sample.id}: line "${d.description}" has no tax_rate_id`);
    }
  }
});

await test("Exact Online payload amounts match the Moneybird payload", async () => {
  for (const sample of buildSamples()) {
    const result = await processDocument(null, {
      bestandsnaam: sample.bestandsnaam,
      fixture: fixtureFor(sample),
    });
    const mb = result.moneybird.purchase_invoice.details_attributes.map((d) => Number(d.price));
    const ex = result.exact.PurchaseEntryLines.map((l) => l.AmountFC);
    assert.deepEqual(ex, mb, sample.id);
  }
});

test("generated PDFs are structurally valid", () => {
  for (const sample of buildSamples()) {
    const pdf = buildPdf([renderInvoice(sample.spec)]);
    const text = pdf.toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4"), `${sample.id}: missing header`);
    assert.ok(text.trimEnd().endsWith("%%EOF"), `${sample.id}: missing trailer`);

    // The xref offsets must point at the "N 0 obj" they claim to.
    const xrefStart = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    assert.ok(Number.isFinite(xrefStart), `${sample.id}: no startxref`);
    assert.equal(text.slice(xrefStart, xrefStart + 4), "xref", `${sample.id}: startxref does not point at xref`);

    const offsets = [...text.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.ok(offsets.length > 0, `${sample.id}: empty xref`);
    offsets.forEach((offset, i) => {
      assert.ok(
        new RegExp(`^${i + 1} 0 obj`).test(text.slice(offset, offset + 20)),
        `${sample.id}: xref entry ${i + 1} points at ${JSON.stringify(text.slice(offset, offset + 20))}`
      );
    });
  }
});

test("the sample set is balanced between clean and defective", () => {
  const samples = buildSamples();
  const review = samples.filter((s) => s.groundTruth.verwachteBeslissing === "review").length;
  assert.ok(review >= 3, "need enough defective samples to demonstrate the review path");
  assert.ok(samples.length - review >= 3, "need enough clean samples to demonstrate auto-posting");
});
