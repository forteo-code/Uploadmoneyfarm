import { Router } from "express";
import { prisma } from "@umf/db";
import { registerSchema, loginSchema, DEFAULT_REV_SHARE_BPS, DEFAULT_MIN_PAYOUT_MICROS } from "@umf/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  hashPassword, verifyPassword, signAccessToken, issueRefreshToken,
  consumeRefreshToken, revokeAllSessions, ACCESS_TTL_SECONDS,
} from "../lib/auth.js";
import { clientIp, userAgent } from "../lib/request.js";
import { hashIp, randomToken } from "../lib/crypto.js";
import { lookupCountry } from "../lib/geoip.js";
import { isProd } from "../env.js";

export const authRouter = Router();

function setAuthCookies(res: import("express").Response, access: string, refresh: string, refreshExpiry: Date) {
  const common = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };
  res.cookie("access_token", access, { ...common, maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie("refresh_token", refresh, { ...common, expires: refreshExpiry });
}

/** Referral codes are short and human-quotable; collisions are retried. */
async function generateReferralCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomToken(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
    if (code.length < 6) continue;
    const existing = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new HttpError(500, "referral_code_generation_failed");
}

authRouter.post(
  "/register",
  rateLimit({ windowSeconds: 3600, max: 10, keyPrefix: "register" }),
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw new HttpError(409, "email_taken");

    let referredById: string | null = null;
    if (input.referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: input.referralCode.toUpperCase() },
        select: { id: true, status: true },
      });
      if (referrer && referrer.status === "ACTIVE") referredById = referrer.id;
    }

    const ip = clientIp(req);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName ?? null,
        referralCode: await generateReferralCode(),
        referredById,
        signupIpHash: hashIp(ip),
        signupCountry: lookupCountry(ip),
        revShareBps: DEFAULT_REV_SHARE_BPS,
        minPayoutMicros: DEFAULT_MIN_PAYOUT_MICROS,
      },
      select: { id: true, email: true, role: true, displayName: true, referralCode: true },
    });

    const access = signAccessToken(user.id, user.role);
    const refresh = await issueRefreshToken(user.id, ip, userAgent(req));
    setAuthCookies(res, access, refresh.token, refresh.expiresAt);
    res.status(201).json({ user, accessToken: access });
  }),
);

authRouter.post(
  "/login",
  rateLimit({ windowSeconds: 900, max: 20, keyPrefix: "login" }),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Same response shape and timing profile whether the email exists or not.
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !ok) throw new HttpError(401, "invalid_credentials");
    if (user.status === "TERMINATED") throw new HttpError(403, "account_terminated");

    const ip = clientIp(req);
    const access = signAccessToken(user.id, user.role);
    const refresh = await issueRefreshToken(user.id, ip, userAgent(req));
    setAuthCookies(res, access, refresh.token, refresh.expiresAt);
    res.json({
      user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName, referralCode: user.referralCode },
      accessToken: access,
    });
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token ?? req.body?.refreshToken;
    if (typeof token !== "string" || !token) throw new HttpError(401, "missing_refresh_token");
    const session = await consumeRefreshToken(token);
    if (!session) throw new HttpError(401, "invalid_refresh_token");
    if (session.user.status === "TERMINATED") throw new HttpError(403, "account_terminated");

    const access = signAccessToken(session.userId, session.user.role);
    const refresh = await issueRefreshToken(session.userId, clientIp(req), userAgent(req));
    setAuthCookies(res, access, refresh.token, refresh.expiresAt);
    res.json({ accessToken: access });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.userId!);
    res.clearCookie("access_token", { path: "/" });
    res.clearCookie("refresh_token", { path: "/" });
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true, email: true, displayName: true, role: true, status: true,
        referralCode: true, revShareBps: true, minPayoutMicros: true,
        payoutMethod: true, payoutAddress: true, strikeCount: true, createdAt: true,
      },
    });
    if (!user) throw new HttpError(404, "not_found");
    res.json({ user: { ...user, minPayoutMicros: user.minPayoutMicros.toString() } });
  }),
);
