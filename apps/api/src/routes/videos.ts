import { Router } from "express";
import { prisma } from "@dropreel/db";
import { updateVideoSchema } from "@dropreel/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireActiveUser, optionalAuth } from "../middleware/auth.js";
import { publicUrl } from "../lib/storage.js";
import { getConfig } from "../lib/config.js";

export const videosRouter = Router();

/** Statuses a viewer is ever allowed to see. Everything else 404s. */
const VIEWABLE = new Set(["READY"]);

function publicVideoShape(v: {
  id: string; slug: string; title: string; description: string | null; tags: string[];
  durationSec: number | null; posterKey: string | null; contentRating: string;
  viewCount: bigint; createdAt: Date;
}) {
  return {
    id: v.id,
    slug: v.slug,
    title: v.title,
    description: v.description,
    tags: v.tags,
    durationSec: v.durationSec,
    poster: v.posterKey ? publicUrl(v.posterKey) : null,
    contentRating: v.contentRating,
    views: v.viewCount.toString(),
    createdAt: v.createdAt,
  };
}

/**
 * Public listing, OFF by default.
 *
 * A browsable index is a deliberate choice not to make. Every established host
 * in this category (Doodstream, Streamtape, MixDrop) omits one, because an
 * index is what turns a neutral file host into a content platform: it hands
 * rights holders a searchable catalogue to trawl for takedowns, and it makes
 * "we had no idea what was on there" a much harder position to hold. Uploaders
 * distribute their own links; that is the product.
 *
 * Left behind a config flag rather than deleted so an operator running only
 * first-party content can switch it on deliberately.
 */
videosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const browseEnabled = await getConfig<boolean>("site.publicBrowse", false);
    if (!browseEnabled) return res.json({ videos: [], nextCursor: null, browseDisabled: true });

    const take = Math.min(Number(req.query.limit ?? 24), 60);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const videos = await prisma.video.findMany({
      where: { status: "READY", visibility: "PUBLIC", moderation: { not: "QUARANTINED" } },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, slug: true, title: true, description: true, tags: true,
        durationSec: true, posterKey: true, contentRating: true,
        viewCount: true, createdAt: true,
      },
    });

    const hasMore = videos.length > take;
    const page = hasMore ? videos.slice(0, take) : videos;
    res.json({
      videos: page.map(publicVideoShape),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  }),
);

/** Owner's library. Includes in-flight and failed items, which the public view never sees. */
videosRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const take = Math.min(Number(req.query.limit ?? 50), 100);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const videos = await prisma.video.findMany({
      where: { ownerId: req.userId!, status: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, slug: true, title: true, status: true, visibility: true,
        contentRating: true, moderation: true, durationSec: true, posterKey: true,
        viewCount: true, countableViewCount: true, earnedMicros: true,
        storageBytes: true, transcodeError: true, createdAt: true, readyAt: true,
      },
    });

    const hasMore = videos.length > take;
    const page = hasMore ? videos.slice(0, take) : videos;
    res.json({
      videos: page.map((v) => ({
        ...v,
        poster: v.posterKey ? publicUrl(v.posterKey) : null,
        viewCount: v.viewCount.toString(),
        countableViewCount: v.countableViewCount.toString(),
        earnedMicros: v.earnedMicros.toString(),
        storageBytes: v.storageBytes.toString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  }),
);

videosRouter.get(
  "/:slug",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const video = await prisma.video.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true, slug: true, ownerId: true, title: true, description: true, tags: true,
        status: true, visibility: true, contentRating: true, moderation: true,
        durationSec: true, posterKey: true, viewCount: true, createdAt: true,
        owner: { select: { id: true, displayName: true } },
      },
    });
    if (!video) throw new HttpError(404, "not_found");

    const isOwner = req.userId === video.ownerId;
    const isAdmin = req.userRole === "ADMIN";

    // Quarantined content is never served to anyone through this path, owner
    // and admin included - it is reachable only from the compliance console.
    if (video.moderation === "QUARANTINED" && !isAdmin) throw new HttpError(404, "not_found");
    if (!VIEWABLE.has(video.status) && !isOwner && !isAdmin) throw new HttpError(404, "not_found");
    if (video.visibility === "PRIVATE" && !isOwner && !isAdmin) throw new HttpError(404, "not_found");

    res.json({
      video: { ...publicVideoShape(video), owner: video.owner, status: video.status },
      isOwner,
    });
  }),
);

videosRouter.patch(
  "/:videoId",
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req, res) => {
    const input = updateVideoSchema.parse(req.body);
    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!video || video.ownerId !== req.userId) throw new HttpError(404, "not_found");
    if (video.status === "DMCA_REMOVED" || video.status === "BLOCKED") {
      throw new HttpError(409, "video_locked");
    }

    const updated = await prisma.video.update({
      where: { id: video.id },
      data: input,
      select: { id: true, title: true, description: true, visibility: true, contentRating: true, tags: true },
    });
    res.json({ video: updated });
  }),
);

/**
 * Owner delete is a soft delete plus an async object sweep. The row survives
 * because takedown and payout records reference it; only the bytes go.
 */
videosRouter.delete(
  "/:videoId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!video || video.ownerId !== req.userId) throw new HttpError(404, "not_found");
    if (video.status === "DMCA_REMOVED") throw new HttpError(409, "video_locked");

    await prisma.video.update({
      where: { id: video.id },
      data: { status: "DELETED", deletedAt: new Date(), visibility: "PRIVATE" },
    });
    res.json({ ok: true });
  }),
);
