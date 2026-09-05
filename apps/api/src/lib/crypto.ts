import crypto from "node:crypto";
import { env } from "../env.js";

/**
 * IPs are never stored raw. They are salted-hashed, which keeps dedupe and
 * abuse investigation working while meaning a database leak does not hand out
 * the viewing history of every visitor.
 */
export function hashIp(ip: string): string {
  return crypto.createHmac("sha256", env.IP_HASH_SALT).update(ip).digest("hex").slice(0, 32);
}

export function hashUa(ua: string): string {
  return crypto.createHmac("sha256", env.IP_HASH_SALT).update(ua).digest("hex").slice(0, 32);
}

/** Dedupe key for view counting: one countable view per visitor per video per day. */
export function visitorHash(ip: string, ua: string, videoId: string, dayBucket: string): string {
  return crypto
    .createHmac("sha256", env.IP_HASH_SALT)
    .update(`${ip}|${ua}|${videoId}|${dayBucket}`)
    .digest("hex")
    .slice(0, 32);
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Constant-time compare for anything secret-shaped. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function dayBucket(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
