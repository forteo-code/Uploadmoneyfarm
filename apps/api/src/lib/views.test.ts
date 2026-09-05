import { describe, it, expect } from "vitest";
import { evaluateCountability, watchThresholdSeconds, FRAUD_REASONS } from "./views.js";

/** A viewer who genuinely watched. Individual tests degrade one field at a time. */
const genuine = {
  watchedSeconds: 45,
  durationSec: 600,
  heartbeats: 5,
  elapsedRealSeconds: 46,
  isBot: false,
  isDatacenter: false,
  duplicateVisitor: false,
  positionAnomalies: 0,
};

describe("watch threshold", () => {
  it("is 30 seconds for anything long enough", () => {
    expect(watchThresholdSeconds(600)).toBe(30);
    expect(watchThresholdSeconds(100)).toBe(30);
  });

  it("scales down for short clips so they remain earnable", () => {
    // A 20s clip can never reach 30s watched; without this it would never pay.
    expect(watchThresholdSeconds(20)).toBeCloseTo(6, 5);
  });

  it("falls back to the fixed threshold when duration is unknown", () => {
    expect(watchThresholdSeconds(null)).toBe(30);
    expect(watchThresholdSeconds(0)).toBe(30);
  });
});

describe("countability", () => {
  it("counts a genuine viewer", () => {
    const result = evaluateCountability(genuine);
    expect(result.countable).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects a viewer who has not watched enough", () => {
    const result = evaluateCountability({ ...genuine, watchedSeconds: 5 });
    expect(result.countable).toBe(false);
    expect(result.reasons).toContain(FRAUD_REASONS.INSUFFICIENT_WATCH);
  });

  it("rejects watch time that outruns wall-clock time", () => {
    // Claiming 45s watched 2s after opening is physically impossible.
    const result = evaluateCountability({ ...genuine, elapsedRealSeconds: 2 });
    expect(result.countable).toBe(false);
    expect(result.reasons).toContain(FRAUD_REASONS.IMPLAUSIBLE_RATE);
  });

  it("rejects a single heartbeat claiming a full view", () => {
    const result = evaluateCountability({ ...genuine, heartbeats: 1 });
    expect(result.countable).toBe(false);
    expect(result.reasons).toContain(FRAUD_REASONS.TOO_FEW_HEARTBEATS);
  });

  it("rejects heartbeats arriving faster than the player could send them", () => {
    const result = evaluateCountability({ ...genuine, heartbeats: 500, elapsedRealSeconds: 46 });
    expect(result.countable).toBe(false);
    expect(result.reasons).toContain(FRAUD_REASONS.HEARTBEAT_FLOOD);
  });

  it("rejects bots, datacenters and duplicates", () => {
    expect(evaluateCountability({ ...genuine, isBot: true }).reasons).toContain(FRAUD_REASONS.BOT_UA);
    expect(evaluateCountability({ ...genuine, isDatacenter: true }).reasons).toContain(FRAUD_REASONS.DATACENTER);
    expect(evaluateCountability({ ...genuine, duplicateVisitor: true }).reasons).toContain(FRAUD_REASONS.DUPLICATE);
  });

  it("tolerates ordinary seeking but not sustained position jitter", () => {
    expect(evaluateCountability({ ...genuine, positionAnomalies: 2 }).countable).toBe(true);
    expect(evaluateCountability({ ...genuine, positionAnomalies: 9 }).reasons)
      .toContain(FRAUD_REASONS.POSITION_JITTER);
  });

  it("reports every reason, not just the first", () => {
    const result = evaluateCountability({
      ...genuine, isBot: true, isDatacenter: true, duplicateVisitor: true, watchedSeconds: 1,
    });
    expect(result.countable).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it("counts a short clip watched proportionally", () => {
    // 20s clip, 8s watched: over the 6s threshold, so it earns.
    const result = evaluateCountability({
      ...genuine, durationSec: 20, watchedSeconds: 8, elapsedRealSeconds: 9, heartbeats: 2,
    });
    expect(result.countable).toBe(true);
  });
});
