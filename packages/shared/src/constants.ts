/** Encoding ladder. Rungs above the source resolution are skipped at transcode. */
export const LADDER = [
  { height: 240, videoKbps: 400, audioKbps: 64, crf: 26 },
  { height: 360, videoKbps: 700, audioKbps: 96, crf: 25 },
  { height: 480, videoKbps: 1200, audioKbps: 128, crf: 24 },
  { height: 720, videoKbps: 2500, audioKbps: 128, crf: 23 },
  { height: 1080, videoKbps: 4500, audioKbps: 160, crf: 22 }, // off by default; see geo.ts
] as const;

/**
 * Delivery codecs.
 *
 * Bandwidth is 70-95% of infrastructure cost, so codec efficiency is the single
 * largest lever available: HEVC and AV1 reach the same perceptual quality at
 * roughly 30-50% lower bitrate than H.264.
 *
 * It is not free. Encoding HEVC costs several times the CPU of H.264 and AV1
 * more again, paid once per upload against a bandwidth saving paid on every
 * view - so it pays off in proportion to how often a video is actually watched,
 * and is a poor trade for a library where most uploads are never viewed.
 *
 * H.264 is always produced regardless. It is the only codec every browser and
 * device decodes, and a viewer who cannot play anything is worth nothing.
 */
export type DeliveryCodec = "h264" | "h265" | "av1";

export const CODEC_PROFILES: Record<DeliveryCodec, {
  /** Bitrate multiplier against the H.264 rung it replaces. */
  bitrateFactor: number;
  /** HLS segment container. HEVC and AV1 need fMP4; MPEG-TS support is poor. */
  container: "mpegts" | "fmp4";
  label: string;
}> = {
  h264: { bitrateFactor: 1.0, container: "mpegts", label: "H.264" },
  h265: { bitrateFactor: 0.65, container: "fmp4", label: "HEVC" },
  av1: { bitrateFactor: 0.55, container: "fmp4", label: "AV1" },
};

/** Codec preference order when a client supports more than one. */
export const CODEC_PREFERENCE: DeliveryCodec[] = ["av1", "h265", "h264"];

export const HLS_SEGMENT_SECONDS = 6;

/** A view only counts once the viewer has watched this much. */
export const COUNTABLE_MIN_SECONDS = 30;
export const COUNTABLE_MIN_FRACTION = 0.3;

/** Redis dedupe window for (ip, ua, video). */
export const VIEW_DEDUPE_WINDOW_SECONDS = 24 * 60 * 60;

/** Player heartbeat cadence, and the tolerance before we call it implausible. */
export const HEARTBEAT_INTERVAL_SECONDS = 10;
export const HEARTBEAT_MIN_INTERVAL_SECONDS = 7;

/** Earnings pend this long before they can be withdrawn. Enables clawback. */
export const EARNINGS_HOLD_DAYS = 30;

export const DEFAULT_REV_SHARE_BPS = 3500;
export const DEFAULT_MIN_PAYOUT_MICROS = 50_000_000n; // $50

/** DMCA response SLA. Safe harbour depends on acting "expeditiously". */
export const DMCA_SLA_HOURS = 24;

/** Strikes before automatic termination. Required for repeat-infringer policy. */
export const REPEAT_INFRINGER_STRIKE_LIMIT = 3;
export const STRIKE_EXPIRY_DAYS = 365;

export const PLAYBACK_TOKEN_TTL_SECONDS = 60 * 60 * 6;
export const SIGNED_SEGMENT_TTL_SECONDS = 60 * 60 * 4;
