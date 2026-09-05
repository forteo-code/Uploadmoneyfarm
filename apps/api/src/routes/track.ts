import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "@dropreel/db";
import { heartbeatSchema, adImpressionSchema, VIEW_DEDUPE_WINDOW_SECONDS, HEARTBEAT_MIN_INTERVAL_SECONDS } from "@dropreel/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { verifyPlaybackToken, tokenHash } from "../lib/playbackToken.js";
import { redis } from "../lib/redis.js";
import { dayBucket } from "../lib/crypto.js";
import { evaluateCountability, watchThresholdSeconds } from "../lib/views.js";
import { creditView, applyViewAggregates, floorToHour } from "../lib/earnings.js";
import { logger } from "../lib/logger.js";

export const trackRouter = Router();

/**
 * Stable per-visitor key for dedupe, derived from values already stored hashed
 * on the session. Raw IPs never enter this path.
 */
function visitorKey(ipHash: string, uaHash: string, videoId: string): string {
  return crypto.createHash("sha256").update(`${ipHash}|${uaHash}|${videoId}|${dayBucket()}`).digest("hex").slice(0, 32);
}

async function loadSession(token: string) {
  const payload = verifyPlaybackToken(token);
  if (!payload) return null;

  const session = await prisma.playbackSession.findUnique({
    where: { id: payload.s },
    include: {
      video: {
        select: {
          id: true, ownerId: true, durationSec: true, status: true,
          owner: { select: { revShareBps: true, status: true } },
        },
      },
      view: { select: { id: true } },
    },
  });
  if (!session) return null;
  // The token must be the one issued for this session, not merely a valid
  // signature - this is what stops a token being reused across sessions.
  if (session.tokenHash !== tokenHash(token)) return null;
  if (session.expiresAt < new Date()) return null;
  return session;
}

/**
 * Heartbeat: the only way a view is ever counted.
 *
 * The player reports its playback position every ~10s. The server judges the
 * shape of that sequence - cadence, monotonicity, watch time against wall-clock
 * time - rather than trusting any single claim.
 */
trackRouter.post(
  "/heartbeat",
  // ~10 heartbeats per viewer per minute; sized for a shared NAT egress.
  rateLimit({ windowSeconds: 60, max: 6000, keyPrefix: "heartbeat" }),
  asyncHandler(async (req, res) => {
    const input = heartbeatSchema.parse(req.body);
    const session = await loadSession(input.token);
    if (!session) throw new HttpError(401, "invalid_session");

    // Already credited: accept the ping and stop. A session pays at most once,
    // enforced structurally by the unique playbackSessionId on View.
    if (session.countedAt || session.view) {
      return res.json({ counted: true });
    }

    const now = new Date();
    const anomalyKey = `hb:anom:${session.id}`;

    // Cadence floor. Heartbeats arriving faster than the player could plausibly
    // emit them are the cheapest way to inflate watch time, so they are dropped
    // rather than recorded.
    if (session.lastHeartbeatAt) {
      const gapSeconds = (now.getTime() - session.lastHeartbeatAt.getTime()) / 1000;
      if (gapSeconds < HEARTBEAT_MIN_INTERVAL_SECONDS * 0.5) {
        return res.json({ counted: false, throttled: true });
      }
    }

    // Position must advance roughly in step with real time. Large forward jumps
    // that are not seeks, or repeated backward jitter, are recorded as
    // anomalies rather than rejected outright - a real viewer does seek.
    const positionDelta = input.position - session.lastPosition;
    if (positionDelta < -2 || positionDelta > 120) {
      await redis.incr(anomalyKey).catch(() => undefined);
      await redis.expire(anomalyKey, 86400).catch(() => undefined);
    }

    const firstAt = session.firstHeartbeatAt ?? now;
    const elapsedRealSeconds = (now.getTime() - firstAt.getTime()) / 1000;
    const heartbeats = session.heartbeatCount + 1;

    // Trust the smaller of what the client claims and what wall-clock allows.
    const watchedSeconds = Math.min(input.watched, elapsedRealSeconds + 15);

    const updated = await prisma.playbackSession.update({
      where: { id: session.id },
      data: {
        heartbeatCount: heartbeats,
        watchedSeconds,
        lastPosition: input.position,
        lastHeartbeatAt: now,
        firstHeartbeatAt: session.firstHeartbeatAt ?? now,
      },
      select: { id: true },
    });

    const threshold = watchThresholdSeconds(session.video.durationSec);
    if (watchedSeconds < threshold) {
      return res.json({ counted: false, progress: watchedSeconds / threshold });
    }

    // --- Threshold reached: decide whether this view earns ---
    const vKey = visitorKey(session.ipHash, session.uaHash, session.videoId);

    // SET NX is the dedupe: the first session for a visitor/video/day wins and
    // every later one is marked duplicate. Redis being unavailable must not
    // silently start paying for duplicates, so a failure counts as duplicate.
    let duplicateVisitor = true;
    try {
      const won = await redis.set(`view:dedupe:${vKey}`, session.id, "EX", VIEW_DEDUPE_WINDOW_SECONDS, "NX");
      duplicateVisitor = won === null;
    } catch (err) {
      logger.warn({ err }, "view dedupe unavailable; treating as duplicate");
    }

    const positionAnomalies = Number((await redis.get(anomalyKey).catch(() => "0")) ?? "0");

    const verdict = evaluateCountability({
      watchedSeconds,
      durationSec: session.video.durationSec,
      heartbeats,
      elapsedRealSeconds,
      isBot: session.isBot,
      isDatacenter: session.isDatacenter,
      duplicateVisitor,
      positionAnomalies,
    });

    // A suspended or terminated uploader keeps serving views but earns nothing.
    const ownerActive = session.video.owner.status === "ACTIVE";
    const shouldPay = verdict.countable && ownerActive;
    if (verdict.countable && !ownerActive) verdict.reasons.push("owner_inactive");

    const country = session.country ?? "XX";
    const hourStart = floorToHour(now);
    const countryConfig = await prisma.countryConfig.findUnique({ where: { code: country } });
    const rpmMicros = countryConfig?.rpmMicros ?? 350_000n;

    // The atomic core is only the two rows that must agree: the View and its
    // ledger credit. Both are inserts on rows nothing else touches, so this
    // transaction takes no contended locks and finishes in milliseconds.
    const { grossMicros, uploaderMicros } = await prisma.$transaction(
      async (tx) => {
        const view = await tx.view.create({
          data: {
            videoId: session.videoId,
            uploaderId: session.video.ownerId,
            playbackSessionId: session.id,
            visitorHash: vKey,
            ipHash: session.ipHash,
            country: session.country,
            asn: session.asn,
            isDatacenter: session.isDatacenter,
            isBot: session.isBot,
            referrerDomain: session.referrerDomain,
            embedDomain: session.embedDomain,
            watchedSeconds,
            heartbeats,
            isCountable: shouldPay,
            // Non-countable views are stored WITH their reasons on purpose:
            // this is the evidence trail for an uploader disputing their
            // numbers, and the data for tuning these rules against real
            // traffic.
            fraudReasons: verdict.reasons,
            cpmTier: session.cpmTier,
          },
          select: { id: true },
        });

        if (!shouldPay) return { grossMicros: 0n, uploaderMicros: 0n };

        const credited = await creditView({
          tx,
          viewId: view.id,
          videoId: session.videoId,
          uploaderId: session.video.ownerId,
          country,
          cpmTier: session.cpmTier,
          hourStart,
          revShareBps: session.video.owner.revShareBps,
          rpmMicros,
        });
        await tx.view.update({ where: { id: view.id }, data: { earnedMicros: credited.uploaderMicros } });
        return credited;
      },
      // Headroom over the default so a slow disk cannot drop a paid view.
      { timeout: 15_000, maxWait: 10_000 },
    );

    // Derived aggregates, outside the transaction. A failure here costs a
    // counter, never a payment - the ledger row above is already durable and
    // rollups are rebuildable from the View table.
    await applyViewAggregates({
      videoId: session.videoId,
      uploaderId: session.video.ownerId,
      country,
      cpmTier: session.cpmTier,
      hourStart,
      countable: shouldPay,
      grossMicros,
      uploaderMicros,
      viewedAt: now,
    }).catch((err) => logger.error({ err, videoId: session.videoId }, "view aggregates failed"));

    await prisma.playbackSession.update({ where: { id: updated.id }, data: { countedAt: now } });

    logger.debug(
      { videoId: session.videoId, counted: shouldPay, reasons: verdict.reasons, watchedSeconds },
      "view resolved",
    );

    res.json({ counted: shouldPay, reasons: shouldPay ? [] : verdict.reasons });
  }),
);

/**
 * Ad impression. Records what was served so the admin console can rank networks
 * by revenue per thousand views per country - which is the whole point of
 * running a waterfall rather than a fixed tag.
 */
trackRouter.post(
  "/impression",
  // A single page view reports one impression per ad unit, so this scales
  // with ads.bannerCount times concurrent viewers on one address.
  rateLimit({ windowSeconds: 60, max: 12000, keyPrefix: "impression" }),
  asyncHandler(async (req, res) => {
    const input = adImpressionSchema.parse(req.body);
    const session = await loadSession(input.token);
    if (!session) throw new HttpError(401, "invalid_session");

    const network = await prisma.adNetwork.findUnique({
      where: { id: input.networkId },
      select: { id: true, estCpmMicros: true },
    });
    if (!network) throw new HttpError(404, "unknown_network");

    // Estimated, not actual: real revenue is only known when the network
    // reports it. This exists to compare networks against each other, and the
    // admin view labels it as an estimate.
    const estRevenueMicros = input.filled ? network.estCpmMicros / 1000n : 0n;

    await prisma.adImpression.create({
      data: {
        playbackSessionId: session.id,
        videoId: session.videoId,
        uploaderId: session.video.ownerId,
        networkId: network.id,
        slotType: input.slotType,
        country: session.country,
        cpmTier: session.cpmTier,
        filled: input.filled,
        estRevenueMicros,
      },
    });

    if (input.filled) {
      await prisma.viewRollupHourly.updateMany({
        where: {
          videoId: session.videoId,
          hourStart: floorToHour(new Date()),
          country: session.country ?? "XX",
        },
        data: { adImpressions: { increment: 1n } },
      });
    }

    res.status(204).end();
  }),
);
