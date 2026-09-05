/**
 * HLS delivery check.
 *
 * Verifies the pipeline serves genuinely playable output, independent of any
 * browser: opens a playback session, confirms the geo quality cap is applied to
 * the master it hands back, walks down to a variant playlist, and fetches real
 * segments checking the MPEG-TS sync byte. Complements the browser smoke test,
 * which covers UI wiring but cannot decode H.264 in a stock Chromium build.
 *
 * Usage: node scripts/hls-check.mjs <slug> [apiUrl]
 */
const slug = process.argv[2];
const API = process.argv[3] ?? process.env.API_URL ?? "http://127.0.0.1:4000";
if (!slug) {
  console.error("usage: node scripts/hls-check.mjs <slug> [apiUrl]");
  process.exit(1);
}

const log = (...a) => console.log("·", ...a);
const failures = [];

const res = await fetch(`${API}/api/playback/${encodeURIComponent(slug)}`, {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0" },
  body: JSON.stringify({}),
});
if (!res.ok) {
  console.error(`FAIL  playback session: HTTP ${res.status}`);
  process.exit(1);
}
const session = await res.json();
const { manifest, maxHeight, availableHeights } = session.playback;
log(`session opened, cap ${maxHeight}p, rungs ${availableHeights.join("/")}`);
log(`manifest: ${manifest.split("/").pop()}`);

// --- master playlist ---
const masterRes = await fetch(manifest);
if (!masterRes.ok) {
  console.error(`FAIL  master playlist: HTTP ${masterRes.status}`);
  process.exit(1);
}
const master = await masterRes.text();
if (!master.startsWith("#EXTM3U")) failures.push("master playlist missing #EXTM3U");

const resolutions = [...master.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => Number(m[1]));
log(`master advertises: ${resolutions.join("p, ")}p`);

// The cap is the point: a rung above it must never be reachable from the
// playlist this viewer was handed.
const over = resolutions.filter((h) => h > maxHeight);
if (over.length > 0) failures.push(`master exposes ${over.join(",")}p above the ${maxHeight}p cap`);
if (resolutions.length === 0) failures.push("master advertises no renditions");

// --- variant playlist ---
const variantPath = master.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
if (!variantPath) {
  console.error("FAIL  master playlist has no variant URI");
  process.exit(1);
}
const variantUrl = new URL(variantPath, manifest).toString();
const variant = await (await fetch(variantUrl)).text();
const segments = variant.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
log(`variant ${variantPath} has ${segments.length} segments`);
if (segments.length === 0) failures.push("variant playlist has no segments");
if (!variant.includes("#EXT-X-ENDLIST")) failures.push("VOD playlist is missing #EXT-X-ENDLIST");

// --- segments ---
let totalBytes = 0;
let checked = 0;
for (const seg of segments.slice(0, 3)) {
  const segUrl = new URL(seg, variantUrl).toString();
  const segRes = await fetch(segUrl);
  if (!segRes.ok) {
    failures.push(`segment ${seg}: HTTP ${segRes.status}`);
    continue;
  }
  const buf = Buffer.from(await segRes.arrayBuffer());
  totalBytes += buf.length;
  checked++;
  // Every MPEG-TS packet starts with 0x47 on a 188-byte boundary.
  if (buf[0] !== 0x47 || buf[188] !== 0x47) {
    failures.push(`segment ${seg} is not valid MPEG-TS (no 0x47 sync)`);
  }
}
log(`fetched ${checked} segments, ${(totalBytes / 1024).toFixed(0)} KB, TS sync verified`);

if (failures.length > 0) {
  console.error("\nFAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nPASS  HLS delivery is valid and the geo quality cap holds");
