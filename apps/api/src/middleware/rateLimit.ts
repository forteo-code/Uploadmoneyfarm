import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis.js";
import { hashIp } from "../lib/crypto.js";
import { clientIp } from "../lib/request.js";

/**
 * Fixed-window limiter in Redis. Deliberately keyed on hashed IP so the limiter
 * itself never stores a raw address.
 *
 * This is the app-level backstop, not the real defence: a serious flood has to
 * be stopped at the edge before it reaches Node at all.
 *
 * IMPORTANT - limits on viewer-facing routes must be generous. A large share of
 * this product's audience sits behind carrier-grade NAT, where an entire mobile
 * network can share one address; that is most pronounced in exactly the
 * mobile-heavy markets this category draws from. A limit tight enough to be
 * meaningful against one abusive host would silently throttle thousands of
 * legitimate viewers on the same carrier IP, suppressing real views and the
 * revenue attached to them - and it would fail quietly, which is worse.
 *
 * Correctness does not depend on these numbers: double-counting is prevented by
 * the per-visitor dedupe in the view tracker, not by rate limiting. So these
 * are set to catch only egregious single-source floods.
 */
export function rateLimit(opts: { windowSeconds: number; max: number; keyPrefix: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = `rl:${opts.keyPrefix}:${hashIp(clientIp(req))}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSeconds);
      if (count > opts.max) {
        res.setHeader("Retry-After", String(opts.windowSeconds));
        return res.status(429).json({ error: "rate_limited" });
      }
      next();
    } catch {
      // A Redis outage must not take the site down; fail open on limiting.
      next();
    }
  };
}
