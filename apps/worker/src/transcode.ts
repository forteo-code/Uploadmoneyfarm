import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@dropreel/db";
import { LADDER } from "@dropreel/shared";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { downloadToFile, uploadFile } from "./lib/storage.js";
import {
  probe, selectRungs, encodeHls, extractPoster, extractSprite,
  buildSpriteVtt, extractGrayFrame,
} from "./lib/ffmpeg.js";
import { phashFromGrayFrame, hammingDistance, PHASH_MATCH_THRESHOLD } from "./lib/phash.js";
import { writeCappedMasters } from "./lib/master.js";

export type TranscodeJob = { videoId: string; sourceKey: string };

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Recursively lists produced files as [absolutePath, relativePath] pairs. */
async function walk(dir: string, base = dir): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, base)));
    else out.push([abs, path.relative(base, abs)]);
  }
  return out;
}

/**
 * The hash-list check. Runs before a single frame is published and blocks on a
 * match. Exact matches are an indexed lookup; near-matches need a scan, so the
 * candidate set is bounded and this is the one place where the list size
 * actually matters operationally. A production deployment swaps the scan for a
 * provider API or a BK-tree index.
 */
async function checkBlockedHash(phash: string, sha256: string): Promise<{ blocked: boolean; reason?: string }> {
  const exact = await prisma.blockedHash.findFirst({
    where: { OR: [{ algo: "sha256", hash: sha256 }, { algo: "phash", hash: phash }] },
    select: { id: true, source: true, algo: true },
  });
  if (exact) return { blocked: true, reason: `hash_list:${exact.algo}:${exact.source}` };

  const candidates = await prisma.blockedHash.findMany({
    where: { algo: "phash" },
    select: { hash: true, source: true },
    take: 50_000,
  });
  for (const c of candidates) {
    if (hammingDistance(phash, c.hash) <= PHASH_MATCH_THRESHOLD) {
      return { blocked: true, reason: `hash_list:phash_near:${c.source}` };
    }
  }
  return { blocked: false };
}

export async function runTranscode(job: TranscodeJob): Promise<void> {
  const { videoId, sourceKey } = job;
  const log = logger.child({ videoId });

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, status: true, ownerId: true, transcodeAttempts: true },
  });
  if (!video) {
    log.warn("video row missing; dropping job");
    return;
  }
  if (video.status === "READY") {
    log.info("already ready; job is a duplicate");
    return;
  }
  if (video.status === "BLOCKED" || video.status === "DMCA_REMOVED" || video.status === "DELETED") {
    log.info({ status: video.status }, "video not eligible for transcode");
    return;
  }

  const workDir = path.resolve(env.TRANSCODE_TMP_DIR, videoId);
  const inputPath = path.join(workDir, "source");
  const outDir = path.join(workDir, "hls");

  await prisma.video.update({
    where: { id: videoId },
    data: { status: "TRANSCODING", transcodeAttempts: { increment: 1 }, transcodeError: null },
  });

  try {
    await mkdir(outDir, { recursive: true });
    await downloadToFile(sourceKey, inputPath);

    const meta = await probe(inputPath);
    log.info({ duration: meta.durationSec, height: meta.height, codec: meta.videoCodec }, "probed");

    // --- Fingerprint and screen before anything becomes playable ---
    const sha256 = await sha256File(inputPath);
    const frame = await extractGrayFrame(inputPath, Math.min(meta.durationSec * 0.1, meta.durationSec - 0.5));
    const phash = phashFromGrayFrame(frame);

    const screen = await checkBlockedHash(phash, sha256);
    if (screen.blocked) {
      // Quarantine rather than delete: the record is required for reporting,
      // and the bytes must not be destroyed before that happens. Nothing is
      // ever served from a QUARANTINED row.
      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: "BLOCKED",
          moderation: "QUARANTINED",
          blockedReason: screen.reason ?? "hash_list",
          sha256, phash,
          visibility: "PRIVATE",
        },
      });
      await prisma.auditLog.create({
        data: {
          actorType: "JOB",
          action: "ingest.blocked",
          targetType: "Video",
          targetId: videoId,
          metadata: { reason: screen.reason ?? "hash_list" },
        },
      });
      log.warn({ reason: screen.reason }, "upload blocked at ingest by hash list");
      return;
    }

    // --- Encode ---
    const allow1080 = await prisma.systemConfig.findUnique({ where: { key: "quality.allow1080p" } });
    const globalMaxHeight = allow1080?.value === true ? 1080 : 720;
    const rungs = selectRungs(meta.height, globalMaxHeight);
    log.info({ rungs: rungs.map((r) => r.height) }, "encoding ladder selected");

    await encodeHls(inputPath, outDir, rungs, meta);

    // Per-cap master playlists, so the geo quality ceiling is enforced by which
    // playlist we hand out rather than trusted to the client.
    const cappedMasters = await writeCappedMasters(outDir);
    log.info({ caps: cappedMasters }, "capped master playlists written");

    const posterPath = path.join(workDir, "poster.jpg");
    await extractPoster(inputPath, posterPath, meta.durationSec);

    const spritePath = path.join(workDir, "sprite.jpg");
    const spriteMeta = await extractSprite(inputPath, spritePath, meta.durationSec);
    const spriteVtt = buildSpriteVtt("sprite.jpg", spriteMeta, meta.durationSec);
    const vttPath = path.join(workDir, "sprite.vtt");
    await writeFile(vttPath, spriteVtt, "utf8");

    // --- Publish ---
    const prefix = `hls/${videoId}`;
    let totalBytes = 0;
    // Per-rung byte totals, not just the aggregate: this is what tells the
    // operator which rung is actually consuming the bandwidth budget, and
    // therefore which one to drop when margin is tight.
    const bytesByRung = new Map<number, number>();
    for (const [abs, rel] of await walk(outDir)) {
      const relKey = rel.split(path.sep).join("/");
      const size = await uploadFile(abs, `${prefix}/${relKey}`);
      totalBytes += size;
      const rungMatch = /^(\d+)p\//.exec(relKey);
      if (rungMatch) {
        const h = Number(rungMatch[1]);
        bytesByRung.set(h, (bytesByRung.get(h) ?? 0) + size);
      }
    }
    totalBytes += await uploadFile(posterPath, `${prefix}/poster.jpg`);
    totalBytes += await uploadFile(spritePath, `${prefix}/sprite.jpg`);
    totalBytes += await uploadFile(vttPath, `${prefix}/sprite.vtt`);

    // Variant rows carry the per-rung playlist keys the player selects between.
    await prisma.$transaction([
      prisma.videoVariant.deleteMany({ where: { videoId } }),
      prisma.videoVariant.createMany({
        data: rungs.map((r) => ({
          videoId,
          height: r.height,
          bitrateKbps: r.videoKbps,
          playlistKey: `${prefix}/${r.height}p/index.m3u8`,
          bytes: BigInt(bytesByRung.get(r.height) ?? 0),
        })),
      }),
      prisma.video.update({
        where: { id: videoId },
        data: {
          status: "READY",
          moderation: "CLEARED",
          readyAt: new Date(),
          durationSec: meta.durationSec,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          videoCodec: meta.videoCodec,
          audioCodec: meta.audioCodec,
          sha256,
          phash,
          hlsMasterKey: `${prefix}/master.m3u8`,
          posterKey: `${prefix}/poster.jpg`,
          spriteKey: `${prefix}/sprite.jpg`,
          spriteVttKey: `${prefix}/sprite.vtt`,
          storageBytes: BigInt(totalBytes),
          transcodeError: null,
        },
      }),
    ]);

    log.info({ bytes: totalBytes, rungs: rungs.length }, "transcode complete");
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((err) =>
      log.warn({ err }, "temp cleanup failed"),
    );
  }
}

/** Called by the worker when BullMQ has exhausted its retries. */
export async function markFailed(videoId: string, message: string): Promise<void> {
  await prisma.video.update({
    where: { id: videoId },
    data: { status: "FAILED", transcodeError: message.slice(0, 1000) },
  }).catch(() => undefined);
}

export { LADDER, stat };
