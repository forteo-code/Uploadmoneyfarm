import { Router } from "express";
import path from "node:path";
import { prisma } from "@dropreel/db";
import { createUploadSchema, completeUploadSchema } from "@dropreel/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireActiveUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { startMultipart, presignPart, completeMultipart, abortMultipart, sourceKey, headObject } from "../lib/storage.js";
import { transcodeQueue } from "../lib/queue.js";
import { randomToken } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";

export const uploadsRouter = Router();

/**
 * 8 MiB parts. Small enough that a dropped connection loses little work on a
 * bad mobile link, large enough to keep the part count and signing round-trips
 * down.
 */
const PART_SIZE = 8 * 1024 * 1024;

/**
 * Default per-file ceiling: 5 GiB.
 *
 * Sized against what it costs rather than what is technically possible. A
 * single file consumes storage every month it exists, and CPU proportional to
 * its length every time it is encoded - both before it has earned anything.
 * 5 GiB comfortably covers a feature-length 1080p source, which is the longest
 * thing this audience realistically uploads, and it caps the damage one account
 * can do before its views have shown whether the content is worth hosting.
 *
 * Operators can raise it, but the cost is linear and paid up front.
 */
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_DAILY_BYTES = 50 * 1024 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 5;

const ALLOWED_EXT = new Set([
  ".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".wmv", ".m4v", ".mpg",
  ".mpeg", ".ts", ".m2ts", ".3gp", ".ogv", ".vob", ".mxf", ".asf", ".rm", ".divx",
]);

async function generateSlug(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const slug = randomToken(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
    if (slug.length < 10) continue;
    const existing = await prisma.video.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  throw new HttpError(500, "slug_generation_failed");
}

/**
 * Step 1: reserve a Video row and open a multipart upload.
 *
 * The API hands back presigned URLs and never sees a byte of video. That keeps
 * app servers small and cheap while upload volume scales independently.
 */
uploadsRouter.post(
  "/create",
  requireAuth,
  requireActiveUser,
  rateLimit({ windowSeconds: 3600, max: 200, keyPrefix: "upload_create" }),
  asyncHandler(async (req, res) => {
    const input = createUploadSchema.parse(req.body);
    const ext = path.extname(input.filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new HttpError(415, "unsupported_file_type");

    // Operator policy, enforced at ingest rather than only hidden in the UI.
    if (input.contentRating === "ADULT" && !(await getConfig<boolean>("content.allowAdult", true))) {
      throw new HttpError(403, "adult_content_disabled");
    }

    const userId = req.userId!;

    const [maxFileBytes, dailyBytes, maxConcurrent] = await Promise.all([
      getConfig<number>("upload.maxFileBytes", DEFAULT_MAX_FILE_BYTES),
      getConfig<number>("upload.dailyBytesPerUser", DEFAULT_DAILY_BYTES),
      getConfig<number>("upload.maxConcurrent", DEFAULT_MAX_CONCURRENT),
    ]);

    if (input.sizeBytes > maxFileBytes) throw new HttpError(413, "file_too_large");

    const inFlight = await prisma.video.count({ where: { ownerId: userId, status: "UPLOADING" } });
    if (inFlight >= maxConcurrent) throw new HttpError(429, "too_many_concurrent_uploads");

    // Rolling 24h byte quota. Stops one account from filling the bucket before
    // the fraud rules have any views to judge it on.
    const since = new Date(Date.now() - 86400_000);
    const recent = await prisma.video.aggregate({
      where: { ownerId: userId, createdAt: { gte: since } },
      _sum: { sourceBytes: true },
    });
    const used = recent._sum.sourceBytes ?? 0n;
    if (used + BigInt(input.sizeBytes) > BigInt(dailyBytes)) {
      throw new HttpError(429, "daily_upload_quota_exceeded");
    }

    const slug = await generateSlug();
    const video = await prisma.video.create({
      data: {
        slug,
        ownerId: userId,
        title: input.title ?? path.basename(input.filename, ext).slice(0, 300),
        status: "UPLOADING",
        contentRating: input.contentRating,
        sourceBytes: BigInt(input.sizeBytes),
        sourceMime: input.mimeType ?? null,
      },
      select: { id: true, slug: true },
    });

    const key = sourceKey(video.id, ext);
    const uploadId = await startMultipart(key, input.mimeType ?? "application/octet-stream");
    await prisma.video.update({ where: { id: video.id }, data: { sourceKey: key } });

    const partCount = Math.max(1, Math.ceil(input.sizeBytes / PART_SIZE));
    if (partCount > 10_000) throw new HttpError(413, "file_too_large");

    res.status(201).json({
      videoId: video.id,
      slug: video.slug,
      uploadId,
      key,
      partSize: PART_SIZE,
      partCount,
    });
  }),
);

/**
 * Step 2: presign one part at a time. Signing lazily (rather than handing over
 * 10,000 URLs up front) keeps the response small and lets a resumed upload ask
 * only for the parts it still needs.
 */
uploadsRouter.get(
  "/:videoId/part/:partNumber",
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const partNumber = Number(req.params.partNumber);
    const uploadId = req.query.uploadId;
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new HttpError(400, "invalid_part_number");
    }
    if (typeof uploadId !== "string" || !uploadId) throw new HttpError(400, "missing_upload_id");

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { ownerId: true, sourceKey: true, status: true },
    });
    if (!video || video.ownerId !== req.userId) throw new HttpError(404, "not_found");
    if (video.status !== "UPLOADING") throw new HttpError(409, "upload_already_finalised");
    if (!video.sourceKey) throw new HttpError(409, "upload_not_initialised");

    const url = await presignPart(video.sourceKey, uploadId, partNumber);
    res.json({ url, partNumber });
  }),
);

/**
 * Step 3: finalise and hand off to the transcode queue. Nothing is playable
 * until the worker has probed it, fingerprinted it and cleared it against the
 * blocked-hash list.
 */
uploadsRouter.post(
  "/:videoId/complete",
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const input = completeUploadSchema.parse(req.body);

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, ownerId: true, sourceKey: true, status: true },
    });
    if (!video || video.ownerId !== req.userId) throw new HttpError(404, "not_found");
    if (video.status !== "UPLOADING") throw new HttpError(409, "upload_already_finalised");
    if (!video.sourceKey) throw new HttpError(409, "upload_not_initialised");

    await completeMultipart(video.sourceKey, input.uploadId, input.parts);

    // Trust the object store's byte count, not the client's declared size.
    const head = await headObject(video.sourceKey);
    const actualBytes = BigInt(head?.ContentLength ?? 0);

    await prisma.video.update({
      where: { id: video.id },
      data: { status: "QUEUED", sourceBytes: actualBytes },
    });

    await transcodeQueue.add(
      "transcode",
      { videoId: video.id, sourceKey: video.sourceKey },
      // Deduplicated on videoId so a double-submitted completion cannot enqueue
      // the same expensive transcode twice.
      { jobId: `transcode-${video.id}` },
    );

    logger.info({ videoId: video.id, bytes: actualBytes.toString() }, "upload complete, queued");
    res.json({ videoId: video.id, status: "QUEUED" });
  }),
);

uploadsRouter.post(
  "/:videoId/abort",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const uploadId = req.body?.uploadId;
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, ownerId: true, sourceKey: true, status: true },
    });
    if (!video || video.ownerId !== req.userId) throw new HttpError(404, "not_found");
    if (video.status !== "UPLOADING") throw new HttpError(409, "upload_already_finalised");

    if (video.sourceKey && typeof uploadId === "string" && uploadId) {
      await abortMultipart(video.sourceKey, uploadId).catch((err) =>
        logger.warn({ err, videoId }, "abort multipart failed; lifecycle rule will reap it"),
      );
    }
    await prisma.video.update({ where: { id: video.id }, data: { status: "DELETED", deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);
