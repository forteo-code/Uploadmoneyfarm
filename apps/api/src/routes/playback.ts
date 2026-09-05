import { randomUUID } from "node:crypto";
import { Router } from "express";
import { prisma } from "@umf/db";
import { tierForCountry, PLAYBACK_TOKEN_TTL_SECONDS } from "@umf/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { optionalAuth } from "../middleware/auth.js";
import { clientIp, userAgent, referrerDomain } from "../lib/request.js";
import { hashIp, hashUa, visitorHash, dayBucket } from "../lib/crypto.js";
import { lookupCountry, lookupAsn, isDatacenterOrg } from "../lib/geoip.js";
import { signPlaybackToken, tokenHash } from "../lib/playbackToken.js";
import { buildAdPlan } from "../lib/ads.js";
import { getConfig } from "../lib/config.js";
import { publicUrl } from "../lib/storage.js";
import { logger } from "../lib/logger.js";

export const playbackRouter = Router();

/** Obvious automation. Cheap first pass; the real signal is heartbeat shape. */
const BOT_UA = /bot|crawler|spider|curl|wget|python-requests|headless|phantom|scrapy|go-http|java\/|okhttp/i;

function highestAllowed(available: number[], requested: number): number {
  const eligible = available.filter((h) => h <= requested);
  return eligible.length > 0 ? Math.max(...eligible) : Math.min(...available);
}

/**
 * Opens a playback session.
 *
 * Does three things that matter commercially: decides which quality ceiling
 * this viewer's country justifies, mints the tracking token, and resolves the
 * ad waterfall for their geo.
 */
playbackRouter.post(
  "/:slug",
  optionalAuth,
  rateLimit({ windowSeconds: 60, max: 60, keyPrefix: "playback" }),
  asyncHandler(async (req, res) => {
    const video = await prisma.video.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true, ownerId: true, slug: true, title: true, status: true, visibility: true,
        moderation: true, contentRating: true, durationSec: true,
        posterKey: true, spriteVttKey: true, hlsMasterKey: true,
        variants: { select: { height: true }, orderBy: { height: "asc" } },
      },
    });

    if (!video) throw new HttpError(404, "not_found");
    if (video.status !== "READY" || video.moderation === "QUARANTINED") throw new HttpError(404, "not_found");
    if (video.visibility === "PRIVATE" && req.userId !== video.ownerId) throw new HttpError(404, "not_found");
    if (video.variants.length === 0) throw new HttpError(409, "no_renditions");

    const ip = clientIp(req);
    const ua = userAgent(req);
    const country = lookupCountry(ip);
    const { asn, org } = lookupAsn(ip);
    const isDatacenter = isDatacenterOrg(org);
    const isBot = BOT_UA.test(ua) || ua.length === 0;

    // Geo-blocking, for jurisdictions whose age-verification regimes the
    // operator has chosen not to serve into.
    const countryConfig = country
      ? await prisma.countryConfig.findUnique({ where: { code: country } })
      : null;
    if (countryConfig?.blocked) throw new HttpError(451, "unavailable_in_region");

    const cpmTier = countryConfig?.tier ?? tierForCountry(country);
    const requestedCap = countryConfig?.maxHeight ?? 480;
    const available = video.variants.map((v) => v.height);
    const servedMaxHeight = highestAllowed(available, requestedCap);

    const vHash = visitorHash(ip, ua, video.id, dayBucket());

    // The session id is minted here rather than by the database so the token
    // can be signed before the insert. Inserting a placeholder tokenHash and
    // patching it afterwards collides on the unique index the moment two
    // viewers open a player at the same time.
    const sessionId = randomUUID();
    const token = signPlaybackToken(sessionId, PLAYBACK_TOKEN_TTL_SECONDS);

    await prisma.playbackSession.create({
      data: {
        id: sessionId,
        videoId: video.id,
        tokenHash: tokenHash(token),
        ipHash: hashIp(ip),
        uaHash: hashUa(ua),
        country,
        asn,
        isDatacenter,
        isBot,
        referrerDomain: referrerDomain(req),
        embedDomain: typeof req.body?.embedDomain === "string" ? req.body.embedDomain.slice(0, 200) : null,
        cpmTier,
        servedMaxHeight,
        expiresAt: new Date(Date.now() + PLAYBACK_TOKEN_TTL_SECONDS * 1000),
      },
      select: { id: true },
    });

    const adPlan = await buildAdPlan({ visitorHash: vHash, country, videoId: video.id, isBot });

    const ageGate = await getConfig<boolean>("content.requireAgeGate", true);

    logger.debug(
      { videoId: video.id, country, cpmTier, servedMaxHeight, slots: Object.keys(adPlan).length },
      "playback session opened",
    );

    res.json({
      session: { token, expiresIn: PLAYBACK_TOKEN_TTL_SECONDS },
      video: {
        id: video.id,
        slug: video.slug,
        title: video.title,
        durationSec: video.durationSec,
        contentRating: video.contentRating,
        poster: video.posterKey ? publicUrl(video.posterKey) : null,
        thumbnails: video.spriteVttKey ? publicUrl(video.spriteVttKey) : null,
      },
      playback: {
        // The capped master, not the full one. Quality ceiling is enforced by
        // what we hand over, not by asking the client to restrain itself.
        manifest: publicUrl(`hls/${video.id}/master_${servedMaxHeight}.m3u8`),
        maxHeight: servedMaxHeight,
        availableHeights: available.filter((h) => h <= servedMaxHeight),
      },
      ads: adPlan,
      policy: { ageGate: ageGate && video.contentRating === "ADULT" },
    });
  }),
);
