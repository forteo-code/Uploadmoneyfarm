import { COUNTABLE_MIN_SECONDS, COUNTABLE_MIN_FRACTION, HEARTBEAT_MIN_INTERVAL_SECONDS } from "@dropreel/shared";

/**
 * View countability.
 *
 * Kept as a pure function with no I/O so it can be tested exhaustively - this
 * is the single most consequential piece of logic in the product, because it
 * decides what the platform pays out on. Everything it needs is passed in.
 *
 * What this design stops: replayed tracking calls (the token is session-bound
 * and issued server-side), a single forged beacon claiming a full view (a
 * plausible heartbeat sequence over real time is required), one visitor
 * refreshing for repeat credit (dedupe), obvious bots, and traffic from
 * hosting providers.
 *
 * What it does NOT stop, stated plainly so nobody assumes otherwise: a
 * determined adversary with a residential proxy pool and a headless browser
 * that actually plays the video in real time. That traffic is close to
 * indistinguishable from a real viewer at the request level. The defences that
 * matter against it are economic rather than technical - the payout hold period
 * and clawback, plus per-uploader anomaly review - because they let the operator
 * be wrong for weeks and still not lose the money.
 */

export const FRAUD_REASONS = {
  BOT_UA: "bot_ua",
  DATACENTER: "datacenter_asn",
  DUPLICATE: "duplicate_visitor",
  INSUFFICIENT_WATCH: "insufficient_watch",
  IMPLAUSIBLE_RATE: "implausible_watch_rate",
  TOO_FEW_HEARTBEATS: "too_few_heartbeats",
  HEARTBEAT_FLOOD: "heartbeat_flood",
  POSITION_JITTER: "position_jitter",
} as const;

export type CountabilityInput = {
  /** Seconds the player claims were actually watched. */
  watchedSeconds: number;
  /** Source duration, when known. */
  durationSec: number | null;
  /** Number of heartbeats received for this session. */
  heartbeats: number;
  /** Wall-clock seconds between the first and latest heartbeat. */
  elapsedRealSeconds: number;
  isBot: boolean;
  isDatacenter: boolean;
  /** True when this visitor already has a countable view of this video today. */
  duplicateVisitor: boolean;
  /** Count of implausible backward/forward position jumps observed. */
  positionAnomalies: number;
};

export type CountabilityResult = { countable: boolean; reasons: string[] };

/** Watch threshold: 30s, or 30% of a short video, whichever is lower. */
export function watchThresholdSeconds(durationSec: number | null): number {
  if (!durationSec || durationSec <= 0) return COUNTABLE_MIN_SECONDS;
  return Math.min(COUNTABLE_MIN_SECONDS, durationSec * COUNTABLE_MIN_FRACTION);
}

export function evaluateCountability(input: CountabilityInput): CountabilityResult {
  const reasons: string[] = [];

  if (input.isBot) reasons.push(FRAUD_REASONS.BOT_UA);
  if (input.isDatacenter) reasons.push(FRAUD_REASONS.DATACENTER);
  if (input.duplicateVisitor) reasons.push(FRAUD_REASONS.DUPLICATE);

  const threshold = watchThresholdSeconds(input.durationSec);
  if (input.watchedSeconds < threshold) reasons.push(FRAUD_REASONS.INSUFFICIENT_WATCH);

  // Watch time cannot exceed the wall-clock time the session has been open.
  // A client reporting 60s watched 4s after opening is fabricating. The 1.5x
  // allowance absorbs clock skew and coalesced timer callbacks.
  if (input.elapsedRealSeconds > 0 && input.watchedSeconds > input.elapsedRealSeconds * 1.5 + 5) {
    reasons.push(FRAUD_REASONS.IMPLAUSIBLE_RATE);
  }

  // Reaching the threshold requires a sequence, not one big claim.
  const expectedHeartbeats = Math.floor(threshold / 15);
  if (input.heartbeats < Math.max(2, expectedHeartbeats)) {
    reasons.push(FRAUD_REASONS.TOO_FEW_HEARTBEATS);
  }

  // More heartbeats than the cadence allows means the client is spamming the
  // endpoint to inflate watch time.
  if (
    input.elapsedRealSeconds > 0 &&
    input.heartbeats > input.elapsedRealSeconds / (HEARTBEAT_MIN_INTERVAL_SECONDS * 0.5) + 3
  ) {
    reasons.push(FRAUD_REASONS.HEARTBEAT_FLOOD);
  }

  if (input.positionAnomalies > 3) reasons.push(FRAUD_REASONS.POSITION_JITTER);

  return { countable: reasons.length === 0, reasons };
}
