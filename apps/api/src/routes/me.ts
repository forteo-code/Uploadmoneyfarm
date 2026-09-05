import { Router } from "express";
import { prisma } from "@dropreel/db";
import { payoutRequestSchema } from "@dropreel/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireActiveUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { getBalances } from "../lib/earnings.js";
import { publicUrl } from "../lib/storage.js";

export const meRouter = Router();

/**
 * Earnings summary. Every figure here is read from ViewRollupHourly, never
 * from the raw View table - that table is the firehose and aggregating it per
 * dashboard load would not survive contact with real traffic.
 */
meRouter.get(
  "/earnings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const since = new Date(Date.now() - 30 * 86400_000);

    const [balances, user, daily, byCountry, topVideos, pendingPayouts] = await Promise.all([
      getBalances(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { revShareBps: true, minPayoutMicros: true, payoutMethod: true, payoutAddress: true, referralCode: true },
      }),
      prisma.$queryRaw<Array<{ day: Date; views: bigint; countable: bigint; earned: bigint }>>`
        SELECT date_trunc('day', "hourStart") AS day,
               SUM("views")::bigint          AS views,
               SUM("countableViews")::bigint AS countable,
               SUM("uploaderMicros")::bigint AS earned
        FROM "ViewRollupHourly"
        WHERE "uploaderId" = ${userId} AND "hourStart" >= ${since}
        GROUP BY 1 ORDER BY 1 DESC`,
      prisma.viewRollupHourly.groupBy({
        by: ["country"],
        where: { uploaderId: userId, hourStart: { gte: since } },
        _sum: { countableViews: true, uploaderMicros: true },
        orderBy: { _sum: { uploaderMicros: "desc" } },
        take: 10,
      }),
      prisma.video.findMany({
        where: { ownerId: userId, status: "READY" },
        orderBy: { earnedMicros: "desc" },
        take: 10,
        select: { id: true, slug: true, title: true, posterKey: true, viewCount: true, countableViewCount: true, earnedMicros: true },
      }),
      prisma.payoutRequest.count({ where: { userId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } }),
    ]);

    if (!user) throw new HttpError(404, "not_found");

    res.json({
      balances: {
        availableMicros: balances.availableMicros.toString(),
        pendingMicros: balances.pendingMicros.toString(),
        lifetimeMicros: balances.lifetimeMicros.toString(),
      },
      account: {
        revShareBps: user.revShareBps,
        minPayoutMicros: user.minPayoutMicros.toString(),
        payoutMethod: user.payoutMethod,
        payoutAddress: user.payoutAddress,
        referralCode: user.referralCode,
        hasPendingPayout: pendingPayouts > 0,
      },
      daily: daily.map((d) => ({
        day: d.day,
        views: d.views.toString(),
        countableViews: d.countable.toString(),
        earnedMicros: d.earned.toString(),
      })),
      byCountry: byCountry.map((c) => ({
        country: c.country,
        countableViews: (c._sum.countableViews ?? 0n).toString(),
        earnedMicros: (c._sum.uploaderMicros ?? 0n).toString(),
      })),
      topVideos: topVideos.map((v) => ({
        id: v.id, slug: v.slug, title: v.title,
        poster: v.posterKey ? publicUrl(v.posterKey) : null,
        views: v.viewCount.toString(),
        countableViews: v.countableViewCount.toString(),
        earnedMicros: v.earnedMicros.toString(),
      })),
    });
  }),
);

meRouter.get(
  "/ledger",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, type: true, amountMicros: true, description: true, availableAt: true, createdAt: true },
    });
    res.json({
      entries: entries.map((e) => ({ ...e, amountMicros: e.amountMicros.toString() })),
    });
  }),
);

meRouter.get(
  "/payouts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payouts = await prisma.payoutRequest.findMany({
      where: { userId: req.userId! },
      orderBy: { requestedAt: "desc" },
      take: 50,
      select: {
        id: true, amountMicros: true, method: true, status: true,
        requestedAt: true, paidAt: true, failureReason: true,
      },
    });
    res.json({ payouts: payouts.map((p) => ({ ...p, amountMicros: p.amountMicros.toString() })) });
  }),
);

/**
 * Requesting a payout debits the ledger immediately, in the same transaction
 * that creates the request.
 *
 * Deferring the debit until an admin approves would let a user submit several
 * requests against the same balance and drain it - the balance is derived from
 * the ledger, so it only falls once a debit row exists. A rejected request is
 * refunded with a compensating PAYOUT_REVERSAL entry rather than by deleting
 * the debit, keeping the ledger append-only.
 */
meRouter.post(
  "/payouts",
  requireAuth,
  requireActiveUser,
  rateLimit({ windowSeconds: 3600, max: 10, keyPrefix: "payout_request" }),
  asyncHandler(async (req, res) => {
    const input = payoutRequestSchema.parse(req.body);
    const amountMicros = BigInt(input.amountMicros);
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { minPayoutMicros: true, balanceFrozen: true, fraudScore: true },
    });
    if (!user) throw new HttpError(404, "not_found");
    if (user.balanceFrozen) throw new HttpError(403, "balance_frozen");
    if (amountMicros < user.minPayoutMicros) throw new HttpError(400, "below_minimum_payout");

    const existing = await prisma.payoutRequest.count({
      where: { userId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } },
    });
    if (existing > 0) throw new HttpError(409, "payout_already_pending");

    const balances = await getBalances(userId);
    if (amountMicros > balances.availableMicros) throw new HttpError(400, "insufficient_available_balance");

    const payout = await prisma.$transaction(async (tx) => {
      const created = await tx.payoutRequest.create({
        data: {
          userId,
          amountMicros,
          method: input.method,
          address: input.address,
          fraudScoreAtRequest: user.fraudScore,
        },
        select: { id: true, amountMicros: true, method: true, status: true, requestedAt: true },
      });
      await tx.ledgerEntry.create({
        data: {
          userId,
          type: "PAYOUT",
          amountMicros: -amountMicros,
          refType: "payout",
          refKey: created.id,
          description: `Payout request (${input.method})`,
          payoutRequestId: created.id,
        },
      });
      return created;
    });

    res.status(201).json({ payout: { ...payout, amountMicros: payout.amountMicros.toString() } });
  }),
);

/** Payout destination. Changing it is audited - it is where the money goes. */
meRouter.patch(
  "/payout-method",
  requireAuth,
  requireActiveUser,
  asyncHandler(async (req, res) => {
    const method = req.body?.method;
    const address = req.body?.address;
    const valid = ["CRYPTO_USDT_TRC20", "CRYPTO_BTC", "PAXUM", "WIRE"];
    if (!valid.includes(method)) throw new HttpError(400, "invalid_method");
    if (typeof address !== "string" || address.length < 4 || address.length > 300) {
      throw new HttpError(400, "invalid_address");
    }

    await prisma.user.update({ where: { id: req.userId! }, data: { payoutMethod: method, payoutAddress: address } });
    await prisma.auditLog.create({
      data: {
        actorId: req.userId!,
        action: "payout_method.changed",
        targetType: "User",
        targetId: req.userId!,
        metadata: { method },
      },
    });
    res.json({ ok: true });
  }),
);
