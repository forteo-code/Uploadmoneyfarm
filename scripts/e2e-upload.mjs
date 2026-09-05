/**
 * End-to-end smoke test for the upload -> transcode -> ready pipeline.
 *
 * Exercises the real HTTP surface the browser uses: register, open a multipart
 * upload, PUT each part straight to storage with a presigned URL, complete, and
 * poll until the worker publishes the HLS ladder.
 *
 * Usage: node scripts/e2e-upload.mjs <path-to-video>
 */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/e2e-upload.mjs <path-to-video>");
  process.exit(1);
}

const log = (...a) => console.log("·", ...a);

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function main() {
  const info = await stat(file);
  log(`source: ${basename(file)} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);

  // --- register ---
  const email = `e2e-${Date.now()}@example.test`;
  let res = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
  });
  const auth = await json(res);
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(auth)}`);
  const token = auth.accessToken;
  log(`registered ${email}`);

  const authHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  // --- open multipart upload ---
  res = await fetch(`${API}/api/uploads/create`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ filename: basename(file), sizeBytes: info.size, mimeType: "video/mp4" }),
  });
  const created = await json(res);
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  log(`upload opened: video=${created.videoId} parts=${created.partCount} partSize=${created.partSize}`);

  // --- PUT each part directly to storage ---
  const buf = await readFile(file);
  const parts = [];
  for (let i = 0; i < created.partCount; i++) {
    const partNumber = i + 1;
    const urlRes = await fetch(
      `${API}/api/uploads/${created.videoId}/part/${partNumber}?uploadId=${encodeURIComponent(created.uploadId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const { url } = await json(urlRes);
    if (!urlRes.ok) throw new Error(`presign failed for part ${partNumber}`);

    const chunk = buf.subarray(i * created.partSize, Math.min((i + 1) * created.partSize, buf.length));
    const put = await fetch(url, { method: "PUT", body: chunk });
    if (!put.ok) throw new Error(`part ${partNumber} PUT failed: ${put.status}`);
    const etag = put.headers.get("etag");
    if (!etag) throw new Error(`part ${partNumber} returned no ETag`);
    parts.push({ partNumber, etag });
    log(`part ${partNumber}/${created.partCount} uploaded (${(chunk.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  // --- complete, which enqueues the transcode ---
  res = await fetch(`${API}/api/uploads/${created.videoId}/complete`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ uploadId: created.uploadId, parts }),
  });
  const completed = await json(res);
  if (!res.ok) throw new Error(`complete failed: ${JSON.stringify(completed)}`);
  log(`upload completed, status=${completed.status}`);

  // --- poll until the worker publishes ---
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const r = await fetch(`${API}/api/videos/mine`, { headers: { authorization: `Bearer ${token}` } });
    const body = await json(r);
    const v = body.videos?.find((x) => x.id === created.videoId);
    if (v && v.status !== last) {
      last = v.status;
      log(`status: ${v.status}`);
    }
    if (v?.status === "READY") {
      log(`ready in ${v.durationSec}s duration, storage=${(Number(v.storageBytes) / 1024 / 1024).toFixed(1)} MB`);
      console.log(`\nPASS  video ${created.videoId} (slug ${created.slug}) is READY`);
      return;
    }
    if (v?.status === "FAILED") throw new Error(`transcode failed: ${v.transcodeError}`);
    if (v?.status === "BLOCKED") throw new Error("blocked at ingest by hash list");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("timed out waiting for READY");
}

main().catch((err) => {
  console.error("\nFAIL ", err.message);
  process.exit(1);
});
