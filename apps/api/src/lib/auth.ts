import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "@umf/db";
import { env } from "../env.js";
import { randomToken, sha256Hex, hashIp, hashUa } from "./crypto.js";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

export type AccessClaims = { sub: string; role: string };

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role } satisfies AccessClaims, env.JWT_SECRET, {
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AccessClaims;
  } catch {
    return null;
  }
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/**
 * Refresh tokens are stored hashed, so a database read cannot be replayed as a
 * login. Rotation happens on every refresh.
 */
export async function issueRefreshToken(userId: string, ip: string, ua: string) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      ipHash: hashIp(ip),
      userAgent: ua.slice(0, 400),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function consumeRefreshToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  return session;
}

export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, hashUa };
