import type { Request, Response, NextFunction } from "express";
import { prisma } from "@umf/db";
import { verifyAccessToken } from "../lib/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies?.access_token;
  return cookie ?? null;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const claims = verifyAccessToken(token);
    if (claims) {
      req.userId = claims.sub;
      req.userRole = claims.role;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) return res.status(401).json({ error: "unauthorized" });
  req.userId = claims.sub;
  req.userRole = claims.role;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.userRole !== "ADMIN") return res.status(403).json({ error: "forbidden" });
  next();
}

/**
 * A terminated or suspended account keeps its data (we need it for compliance
 * records) but loses the ability to act. Checked per-request rather than baked
 * into the JWT so a termination takes effect immediately rather than at token
 * expiry.
 */
export async function requireActiveUser(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "unauthorized" });
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { status: true },
  });
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (user.status !== "ACTIVE") {
    return res.status(403).json({ error: "account_" + user.status.toLowerCase() });
  }
  next();
}
