import type { Request } from "express";

/**
 * Behind a CDN, req.ip is the proxy. We trust the leftmost X-Forwarded-For
 * entry only because the app is expected to sit behind a proxy that rewrites
 * it; exposed directly to the internet this header is attacker-controlled and
 * `trust proxy` must be set accordingly.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  return req.ip ?? "0.0.0.0";
}

export function userAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "";
}

export function referrerDomain(req: Request): string | null {
  const ref = req.headers.referer ?? req.headers.referrer;
  if (typeof ref !== "string") return null;
  try {
    return new URL(ref).hostname.toLowerCase().slice(0, 200);
  } catch {
    return null;
  }
}
