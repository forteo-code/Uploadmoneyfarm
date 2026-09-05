import crypto from "node:crypto";
import { env } from "../env.js";

/**
 * Playback tokens bind a viewer's tracking calls to one server-issued session.
 *
 * The point is that the tracking endpoint cannot be replayed: a token is minted
 * server-side per player load, carries its own expiry, and its hash is stored
 * on the PlaybackSession row. Someone scripting POSTs at the heartbeat endpoint
 * has to first obtain a session, which is rate-limited and fingerprinted.
 */
export type PlaybackTokenPayload = { s: string; e: number };

export function signPlaybackToken(sessionId: string, ttlSeconds: number): string {
  const payload: PlaybackTokenPayload = { s: sessionId, e: Date.now() + ttlSeconds * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", env.PLAYBACK_TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPlaybackToken(token: string): PlaybackTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];

  const expected = crypto.createHmac("sha256", env.PLAYBACK_TOKEN_SECRET).update(body).digest("base64url");
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PlaybackTokenPayload;
    if (typeof payload.s !== "string" || typeof payload.e !== "number") return null;
    if (payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
