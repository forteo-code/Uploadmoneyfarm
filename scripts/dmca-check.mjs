/**
 * Verifies the compliance path end to end.
 *
 * A takedown notice arrives from an anonymous claimant, appears in the admin
 * queue with an SLA countdown, is actioned, and the result is: the video's
 * bytes are gone, the row survives for the record, and its owner carries a
 * strike. That chain is what DMCA safe harbour actually depends on, so it is
 * verified rather than assumed.
 *
 * Usage: node scripts/dmca-check.mjs [apiUrl]
 */
const API = process.argv[2] ?? process.env.API_PUBLIC_URL ?? "http://127.0.0.1:4000";
const ADMIN = { email: "admin@dropreel.local", password: "admin-dev-password" };
const UPLOADER = { email: "demo@dropreel.local", password: "demo-account-password" };

const log = (...a) => console.log("·", ...a);
const failures = [];

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON ${res.status}: ${text.slice(0, 200)}`); }
}

async function login(creds) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds),
  });
  if (!res.ok) throw new Error(`login failed for ${creds.email}: ${JSON.stringify(await json(res))}`);
  return (await json(res)).accessToken;
}

// A video to target, owned by the demo uploader.
const uploaderToken = await login(UPLOADER);
const mine = await json(await fetch(`${API}/api/videos/mine?limit=10`, {
  headers: { authorization: `Bearer ${uploaderToken}` },
}));
const target = mine.videos?.find((v) => v.status === "READY");
if (!target) {
  console.error("FAIL  no READY video to target (run scripts/seed-demo-account.mjs first)");
  process.exit(1);
}
log(`targeting "${target.title}" (${target.slug})`);

// 1. Anonymous claimant files a notice.
const noticeRes = await fetch(`${API}/api/dmca/notice`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    claimantName: "Rights Holder Ltd",
    claimantEmail: "legal@rightsholder.test",
    claimantOrg: "Rights Holder Ltd",
    claimantAddress: "1 Legal Street, London, EC1A 1AA",
    targetUrls: [`http://127.0.0.1:3000/watch/${target.slug}`],
    workDescription: "Feature film, all territories. Uploaded without licence.",
    goodFaithStatement: true,
    accuracyStatement: true,
    signature: "A. Lawyer",
  }),
});
const notice = await json(noticeRes);
if (!noticeRes.ok) { console.error("FAIL  notice rejected:", notice); process.exit(1); }
log(`notice ${notice.noticeId} accepted, due ${new Date(notice.dueAt).toLocaleTimeString()}`);

// 2. It appears in the admin queue, matched to the video.
const adminToken = await login(ADMIN);
const queue = await json(await fetch(`${API}/api/admin/dmca?status=RECEIVED`, {
  headers: { authorization: `Bearer ${adminToken}` },
}));
const queued = queue.notices?.find((n) => n.id === notice.noticeId);
if (!queued) failures.push("notice did not appear in the admin queue");
else {
  log(`queued with ${queued.hoursRemaining}h remaining on the SLA`);
  if (!queued.targets?.[0]?.video) failures.push("claimant URL was not matched to a video");
  else log(`URL resolved to "${queued.targets[0].video.title}"`);
}

// 3. Action it.
const actionRes = await fetch(`${API}/api/admin/dmca/${notice.noticeId}/action`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
  body: "{}",
});
const action = await json(actionRes);
if (!actionRes.ok) { console.error("FAIL  action failed:", action); process.exit(1); }
log(`actioned: ${action.removed} video(s) removed, ${action.strikes.length} account(s) struck`);
if (action.removed !== 1) failures.push(`expected 1 removal, got ${action.removed}`);
if (action.strikes.length !== 1) failures.push(`expected 1 strike, got ${action.strikes.length}`);

// 4. The video is gone from public view but the row survives for the record.
const publicRes = await fetch(`${API}/api/videos/${target.slug}`);
if (publicRes.ok) failures.push("removed video is still publicly reachable");
else log(`public access now returns ${publicRes.status}`);

const after = await json(await fetch(`${API}/api/videos/mine?limit=20`, {
  headers: { authorization: `Bearer ${uploaderToken}` },
}));
const row = after.videos?.find((v) => v.id === target.id);
if (!row) failures.push("video row was destroyed - takedown records must survive");
else if (row.status !== "DMCA_REMOVED") failures.push(`expected DMCA_REMOVED, got ${row.status}`);
else log("row retained with status DMCA_REMOVED");

// 5. Re-actioning the same notice must not double-strike.
const replay = await fetch(`${API}/api/admin/dmca/${notice.noticeId}/action`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
  body: "{}",
});
if (replay.ok) failures.push("an already-actioned notice could be actioned again");
else log(`replay correctly refused (${replay.status})`);

if (failures.length > 0) {
  console.error("\nFAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nPASS  notice received, matched, actioned, content removed, strike issued, record retained");
