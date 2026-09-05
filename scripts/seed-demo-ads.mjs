/**
 * Seeds a complete self-hosted demo ad stack.
 *
 * Ad networks will not issue tags until they can see a live site with content,
 * so there is no way to evaluate the ad experience before launch using real
 * inventory. This generates a genuine VAST pre-roll creative, uploads it to the
 * media bucket, and registers demo networks for every slot - letting the
 * operator see exactly what a viewer gets and tune the aggression before
 * committing to any network.
 *
 * Usage: node scripts/seed-demo-ads.mjs [--off]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const run = promisify(execFile);
const prisma = new PrismaClient();
const disable = process.argv.includes("--off");

const API = process.env.API_PUBLIC_URL ?? "http://127.0.0.1:4000";

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

/**
 * VP9/WebM rather than H.264. Ad creatives are served straight to the browser
 * outside the HLS ladder, and WebM plays in every environment including
 * codec-stripped CI browsers, which keeps the demo verifiable in automation.
 */
async function buildCreative(outPath) {
  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x101820:size=1280x720:rate=25",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000",
    "-t", "15",
    "-vf", [
      `drawtext=fontfile=${font}:text='DEMO ADVERTISER':fontcolor=0xffb84d:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-40`,
      `drawtext=fontfile=${font}:text='Your pre-roll ad plays here':fontcolor=white@0.8:fontsize=30:x=(w-text_w)/2:y=(h-text_h)/2+50`,
      `drawtext=fontfile=${font}:text='skippable after 5s':fontcolor=white@0.4:fontsize=22:x=(w-text_w)/2:y=h-80`,
    ].join(","),
    "-c:v", "libvpx-vp9", "-b:v", "800k", "-deadline", "realtime", "-cpu-used", "8",
    "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "64k",
    outPath,
  ]);
}

const creative = (label, width, height, note) => `
<div style="width:${width}px;max-width:100%;height:${height}px;background:linear-gradient(135deg,#1b2130,#2a1f33);
            border:1px solid #3a4152;border-radius:6px;display:flex;flex-direction:column;
            align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#e6e8ec;gap:6px;">
  <span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#04121f;
               background:#ffb84d;padding:2px 8px;border-radius:3px;">${label}</span>
  <strong style="font-size:15px;">Demo Advertiser</strong>
  <span style="font-size:11.5px;color:#9aa2b1;text-align:center;padding:0 14px;line-height:1.45;">${note}</span>
</div>`.trim();

const DEMO_NETWORKS = [
  {
    key: "demo_preroll", name: "Demo pre-roll (VAST)", slotType: "PREROLL",
    priority: 1, weight: 100, estCpmMicros: 4_000_000n, frequencyCapPerHour: 50,
    vastTemplate: `${API}/api/ads/demo/vast.xml`,
  },
  {
    key: "demo_popunder", name: "Demo pop-under", slotType: "POPUNDER",
    priority: 1, weight: 100, estCpmMicros: 1_800_000n, frequencyCapPerHour: 50,
    // Opens from inside the play click, which is the only way a browser allows it.
    scriptTemplate: `<script>try{window.open('${API}/api/ads/demo/landing','_blank','width=760,height=520')}catch(e){}</script>`,
  },
  {
    key: "demo_overlay", name: "Demo overlay banner", slotType: "OVERLAY",
    priority: 1, weight: 100, estCpmMicros: 500_000n, frequencyCapPerHour: 50,
    scriptTemplate: creative("Overlay ad", 468, 60, "Sits over the video after 10 seconds. Dismissible."),
  },
  {
    key: "demo_interstitial", name: "Demo click-to-open", slotType: "INTERSTITIAL",
    priority: 1, weight: 100, estCpmMicros: 1_200_000n, frequencyCapPerHour: 50,
    // Fires on the click AFTER playback starts - see ClickAd for why.
    scriptTemplate: `<script>try{window.open('${API}/api/ads/demo/landing?src=click','_blank')}catch(e){}</script>`,
  },
  {
    key: "demo_banner", name: "Demo side banner", slotType: "BANNER",
    priority: 1, weight: 100, estCpmMicros: 400_000n, frequencyCapPerHour: 50,
    scriptTemplate: creative("Banner ad", 300, 250, "Beside the player on the watch page."),
  },
];

async function main() {
  if (disable) {
    await prisma.systemConfig.upsert({
      where: { key: "ads.demoMode" }, update: { value: false }, create: { key: "ads.demoMode", value: false },
    });
    console.log("demo ad mode disabled; live networks are active again");
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "umf-demo-"));
  try {
    const creativePath = path.join(dir, "preroll.webm");
    console.log("· encoding demo pre-roll creative…");
    await buildCreative(creativePath);
    const body = await readFile(creativePath);

    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: "demo/preroll.webm",
      Body: body,
      ContentType: "video/webm",
      CacheControl: "public, max-age=3600",
    }));
    console.log(`· uploaded demo/preroll.webm (${(body.length / 1024).toFixed(0)} KB)`);

    for (const n of DEMO_NETWORKS) {
      const data = {
        name: n.name, slotType: n.slotType, priority: n.priority, weight: n.weight,
        estCpmMicros: n.estCpmMicros, frequencyCapPerHour: n.frequencyCapPerHour,
        enabled: true,
        scriptTemplate: n.scriptTemplate ?? null,
        vastTemplate: n.vastTemplate ?? null,
      };
      await prisma.adNetwork.upsert({
        where: { key: n.key }, update: data, create: { key: n.key, geoAllow: [], ...data },
      });
    }
    console.log(`· registered ${DEMO_NETWORKS.length} demo networks`);

    await prisma.systemConfig.upsert({
      where: { key: "ads.demoMode" }, update: { value: true }, create: { key: "ads.demoMode", value: true },
    });
    console.log("\ndemo ad mode ON - every slot now serves demo inventory.");
    console.log("turn it off with: node scripts/seed-demo-ads.mjs --off");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
