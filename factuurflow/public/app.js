/* FactuurFlow demo front-end. No framework: one file, no build step. */

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const state = { samples: [], active: null, payloadTab: "moneybird", last: null, live: false };

const el = {
  status: document.getElementById("status"),
  list: document.getElementById("sample-list"),
  viewer: document.getElementById("viewer"),
  result: document.getElementById("result"),
  title: document.getElementById("doc-title"),
  sub: document.getElementById("doc-sub"),
  file: document.getElementById("file-input"),
  uploadHint: document.getElementById("upload-hint"),
};

init();

async function init() {
  try {
    const status = await fetchJson("/api/status");
    state.live = status.liveExtraction;
    el.status.textContent = status.liveExtraction
      ? `live extractie · ${status.model}`
      : "opgeslagen extracties · geen API-sleutel";
    el.status.classList.toggle("live", status.liveExtraction);
    if (!status.liveExtraction) {
      el.uploadHint.textContent =
        "Voor een eigen document is een ANTHROPIC_API_KEY nodig. De voorbeelden werken zonder.";
    }

    state.samples = await fetchJson("/api/samples");
    renderList();
    select(state.samples[0].id);
  } catch (err) {
    el.status.textContent = "server niet bereikbaar";
    el.result.innerHTML = `<div class="error-box">${escapeHtml(String(err))}</div>`;
  }
}

function renderList() {
  el.list.innerHTML = "";
  for (const sample of state.samples) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = sample.id;
    button.innerHTML = `
      <span class="sample-name"><span class="dot ${sample.verwacht}"></span>${escapeHtml(sample.leverancier)}</span>
      <span class="sample-meta">
        <span>${escapeHtml(sample.factuurnummer ?? "geen nummer")}</span>
        <span>${euro.format(sample.totaalIncl / 100)}</span>
      </span>`;
    button.addEventListener("click", () => select(sample.id));
    li.append(button);
    el.list.append(li);
  }
}

async function select(id) {
  const sample = state.samples.find((s) => s.id === id);
  if (!sample) return;

  state.active = id;
  for (const button of el.list.querySelectorAll("button")) {
    button.setAttribute("aria-current", String(button.dataset.id === id));
  }

  el.title.textContent = sample.leverancier;
  el.sub.textContent = sample.waarom;
  el.viewer.innerHTML = `<iframe src="/api/samples/${encodeURIComponent(id)}.pdf#toolbar=0&navpanes=0&view=FitH" title="Factuur"></iframe>`;
  el.result.innerHTML = `<div class="spinner">Document lezen en controleren…</div>`;

  try {
    const result = await postJson("/api/process", { sample: id });
    state.last = result;
    renderResult(result);
  } catch (err) {
    el.result.innerHTML = `<div class="error-box">${escapeHtml(String(err))}</div>`;
  }
}

el.file.addEventListener("change", async () => {
  const file = el.file.files?.[0];
  if (!file) return;

  state.active = null;
  for (const button of el.list.querySelectorAll("button")) button.setAttribute("aria-current", "false");

  el.title.textContent = file.name;
  el.sub.textContent = `${(file.size / 1024).toFixed(0)} kB`;
  el.viewer.innerHTML = `<iframe src="${URL.createObjectURL(file)}#toolbar=0" title="Factuur"></iframe>`;
  el.result.innerHTML = `<div class="spinner">Document lezen en controleren…</div>`;

  try {
    const base64 = await toBase64(file);
    const result = await postJson("/api/process", {
      bestand: base64,
      bestandsnaam: file.name,
      mediaType: file.type || "application/pdf",
    });
    state.last = result;
    renderResult(result);
  } catch (err) {
    el.result.innerHTML = `<div class="error-box">${escapeHtml(String(err))}</div>`;
  } finally {
    el.file.value = "";
  }
});

function renderResult(result) {
  const inv = result.invoice;
  const auto = result.beslissing === "auto_post";
  const errors = result.redenen.filter((r) => r.severity === "error");

  el.result.innerHTML = `
    <div class="verdict">
      <span class="verdict-badge ${result.beslissing}">
        ${auto ? "Wordt automatisch geboekt" : "Naar controle"}
      </span>
      <p>${
        auto
          ? "Alle controles geslaagd. De boeking hieronder kan zonder tussenkomst naar de administratie."
          : `${errors.length} ${errors.length === 1 ? "controle" : "controles"} niet geslaagd. De factuur wordt niet geboekt en gaat met onderstaande reden naar een medewerker.`
      }</p>
    </div>

    <div class="section">
      <h3>Gelezen gegevens</h3>
      <dl class="kv">
        <dt>Leverancier</dt><dd>${escapeHtml(inv.leverancier.naam)}</dd>
        <dt>Documenttype</dt><dd>${escapeHtml(inv.document_type)}</dd>
        <dt>Factuurnummer</dt><dd>${escapeHtml(inv.factuurnummer ?? "—")}</dd>
        <dt>Factuurdatum</dt><dd>${escapeHtml(inv.factuurdatum ?? "—")}</dd>
        <dt>Vervaldatum</dt><dd>${escapeHtml(inv.vervaldatum ?? "—")}</dd>
        <dt>IBAN</dt><dd>${escapeHtml(inv.leverancier.iban ?? "—")}</dd>
        <dt>Btw-nummer</dt><dd>${escapeHtml(inv.leverancier.btw_nummer ?? "—")}</dd>
        <dt>Subtotaal</dt><dd>${money(result.validatie.totals.subtotaalExcl, inv.valuta)}</dd>
        <dt>Btw</dt><dd>${money(result.validatie.totals.totaalBtw, inv.valuta)}${inv.btw_verlegd ? " (verlegd)" : ""}</dd>
        <dt>Totaal</dt><dd><b>${money(result.validatie.totals.totaalIncl, inv.valuta)}</b></dd>
      </dl>
    </div>

    <div class="section">
      <h3>Regels en grootboek</h3>
      <table class="lines">
        <thead><tr><th>Omschrijving</th><th class="num">Btw</th><th class="num">Bedrag</th></tr></thead>
        <tbody>${inv.regels
          .map((line, i) => {
            const cls = result.grootboek.regels[i];
            const account = cls?.account
              ? `<span class="acct">${cls.account.code} ${escapeHtml(cls.account.naam)}${
                  cls.bron === "leverancier" ? " · vaste koppeling" : ""
                }</span>`
              : `<span class="acct">geen rekening bekend</span>`;
            return `<tr>
              <td>${escapeHtml(line.omschrijving)}${account}</td>
              <td class="num">${escapeHtml(line.btw_percentage)}%</td>
              <td class="num">${escapeHtml(line.bedrag_excl_btw)}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>
    </div>

    <div class="section">
      <h3>Controles</h3>
      ${
        result.redenen.length === 0
          ? `<p class="all-clear">Alle controles geslaagd: bedragen tellen op, btw klopt per tarief, IBAN en btw-nummer zijn geldig, datums zijn consistent.</p>`
          : result.redenen.map(renderFinding).join("")
      }
    </div>

    <div class="section">
      <h3>Boeking</h3>
      <div class="tabs">
        <button type="button" data-tab="moneybird" aria-selected="${state.payloadTab === "moneybird"}">Moneybird</button>
        <button type="button" data-tab="exact" aria-selected="${state.payloadTab === "exact"}">Exact Online</button>
      </div>
      <pre class="payload">${escapeHtml(
        JSON.stringify(state.payloadTab === "moneybird" ? result.moneybird : result.exact, null, 2)
      )}</pre>
    </div>

    <div class="section">
      <h3>Verwerking</h3>
      <div class="meta-row">
        <span>bron <b>${result.bron === "api" ? "live model" : "opgeslagen"}</b></span>
        ${result.bron === "api" ? `<span>model <b>${escapeHtml(result.meta.model)}</b></span>` : ""}
        ${result.bron === "api" ? `<span>duur <b>${(result.meta.durationMs / 1000).toFixed(1)} s</b></span>` : ""}
        ${
          result.bron === "api"
            ? `<span>kosten <b>${result.meta.estimatedCostCents.toFixed(2)} eurocent</b></span>`
            : ""
        }
        <span>tolerantie <b>${result.validatie.tolerance} cent</b></span>
      </div>
    </div>`;

  for (const button of el.result.querySelectorAll(".tabs button")) {
    button.addEventListener("click", () => {
      state.payloadTab = button.dataset.tab;
      renderResult(state.last);
    });
  }
}

function renderFinding(finding) {
  const compare =
    finding.expected || finding.found
      ? `<div class="compare">
           ${finding.expected ? `<span>verwacht <b>${escapeHtml(finding.expected)}</b></span>` : ""}
           ${finding.found ? `<span>gevonden <b>${escapeHtml(finding.found)}</b></span>` : ""}
         </div>`
      : "";
  return `<div class="finding ${finding.severity}">
      <div class="finding-head">
        <strong>${escapeHtml(finding.field)}</strong>
        <code>${escapeHtml(finding.code)}</code>
      </div>
      <p>${escapeHtml(finding.message)}</p>
      ${compare}
    </div>`;
}

function money(cents, currency) {
  if (cents === null || cents === undefined) return "—";
  const value = cents / 100;
  if (currency && currency !== "EUR") {
    return `${currency} ${value.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return euro.format(value);
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
