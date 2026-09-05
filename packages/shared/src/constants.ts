/** Encoding ladder. Rungs above the source resolution are skipped at transcode. */
export const LADDER = [
  { height: 240, videoKbps: 400, audioKbps: 64, crf: 26 },
  { height: 360, videoKbps: 700, audioKbps: 96, crf: 25 },
  { height: 480, videoKbps: 1200, audioKbps: 128, crf: 24 },
  { height: 720, videoKbps: 2500, audioKbps: 128, crf: 23 },
  { height: 1080, videoKbps: 4500, audioKbps: 160, crf: 22 }, // off by default; see geo.ts
] as const;

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
