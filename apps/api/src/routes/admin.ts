import { Router } from "express";
import { prisma } from "@dropreel/db";
import { DMCA_SLA_HOURS } from "@dropreel/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { takedownVideo, issueStrike, clawback } from "../lib/moderation.js";
import { getBalances } from "../lib/earnings.js";
import { getConfig, setConfig } from "../lib/config.js";
import { publicUrl } from "../lib/storage.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const s = (v: bigint | null | undefined) => (v ?? 0n).toString();

adminRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400_000);

    const [users, videos, overdueDmca, openDmca, pendingPayouts, quarantined, openReports, day] =
      await Promise.all([
        prisma.user.count(),
        prisma.video.count({ where: { status: "READY" } }),
        prisma.dmcaNotice.count({ where: { status: "RECEIVED", dueAt: { lt: now } } }),
        prisma.dmcaNotice.count({ where: { status: "RECEIVED" } }),
        prisma.payoutRequest.count({ where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } }),
        prisma.video.count({ where: { moderation: "QUARANTINED" } }),
        prisma.abuseReport.count({ where: { status: "OPEN" } }),
        prisma.viewRollupHourly.aggregate({
          where: { hourStart: { gte: dayAgo } },
          _sum: { views: true, countableViews: true, grossMicros: true, uploaderMicros: true, adImpressions: true },
        }),
      ]);

    res.json({
      users,
      videos,
      dmca: { open: openDmca, overdue: overdueDmca, slaHours: DMCA_SLA_HOURS },
      pendingPayouts,
      quarantined,
      openReports,
      last24h: {
        views: s(day._sum.views),
        countableViews: s(day._sum.countableViews),
        adImpressions: s(day._sum.adImpressions),
        grossMicros: s(day._sum.grossMicros),
        uploaderMicros: s(day._sum.uploaderMicros),
        // What the platform keeps after the uploader share.
        marginMicros: ((day._sum.grossMicros ?? 0n) - (day._sum.uploaderMicros ?? 0n)).toString(),
      },
    });
  }),
);

/** Takedown queue, ordered so the ones closest to breaching the SLA come first. */
adminRouter.get(
  "/dmca",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "RECEIVED";
    const notices = await prisma.dmcaNotice.findMany({
      where: status === "ALL" ? {} : { status: status as never },
      orderBy: { dueAt: "asc" },
      take: 100,
      include: {
        targets: {
          select: {
            id: true, url: true, resolved: true,
            video: { select: { id: true, slug: true, title: true, status: true, ownerId: true } },
          },
        },
        counterNotices: { select: { id: true, submittedAt: true } },
      },
    });

    const now = Date.now();
    res.json({
      notices: notices.map((n) => ({
        id: n.id,
        claimant: { name: n.claimantName, email: n.claimantEmail, org: n.claimantOrg },
        workDescription: n.workDescription,
        status: n.status,
        receivedAt: n.receivedAt,
        dueAt: n.dueAt,
        // Negative means the SLA has already been missed.
        hoursRemaining: Math.round(((n.dueAt.getTime() - now) / 3600_000) * 10) / 10,
        overdue: n.dueAt.getTime() < now && n.status === "RECEIVED",
        targets: n.targets,
        counterNotices: n.counterNotices,
      })),
    });
  }),
);

/**
 * Actions a notice: removes each matched video and strikes its owner.
 *
 * One strike per owner per notice, not per video - a claimant listing forty
 * files from one uploader is one infringement event, and counting it as forty
 * would terminate the account on a single notice.
 */
adminRouter.post(
  "/dmca/:id/action",
  asyncHandler(async (req, res) => {
    const notice = await prisma.dmcaNotice.findUnique({
      where: { id: req.params.id },
      include: { targets: { include: { video: { select: { id: true, ownerId: true } } } } },
    });
    if (!notice) throw new HttpError(404, "not_found");
    if (notice.status !== "RECEIVED") throw new HttpError(409, "already_actioned");

    const owners = new Set<string>();
    let removed = 0;

    for (const target of notice.targets) {
      if (!target.video) continue;
      await takedownVideo({
        videoId: target.video.id,
        reason: `DMCA notice ${notice.id}`,
        actorId: req.userId!,
        status: "DMCA_REMOVED",
      });
      await prisma.dmcaTarget.update({ where: { id: target.id }, data: { resolved: true } });
      owners.add(target.video.ownerId);
      removed++;
    }

    const outcomes: Array<{ userId: string; strikeCount: number; terminated: boolean }> = [];
    for (const userId of owners) {
      const result = await issueStrike({
        userId, reason: "DMCA", noticeId: notice.id, actorId: req.userId!,
        note: `Notice from ${notice.claimantName}`,
      });
      outcomes.push({ userId, ...result });
    }

    await prisma.dmcaNotice.update({
      where: { id: notice.id },
      data: { status: "ACTIONED", actionedAt: new Date(), actionedById: req.userId! },
    });

    res.json({ removed, strikes: outcomes });
  }),
);

adminRouter.post(
  "/dmca/:id/reject",
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Incomplete or invalid notice";
    const notice = await prisma.dmcaNotice.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (!notice) throw new HttpError(404, "not_found");
    if (notice.status !== "RECEIVED") throw new HttpError(409, "already_actioned");

    await prisma.dmcaNotice.update({
      where: { id: req.params.id },
      data: { status: "REJECTED", actionedAt: new Date(), actionedById: req.userId!, rejectionReason: reason.slice(0, 500) },
    });
    await prisma.auditLog.create({
      data: { actorId: req.userId!, action: "dmca.rejected", targetType: "DmcaNotice", targetId: req.params.id, metadata: { reason } },
    });
    res.json({ ok: true });
  }),
);

/** Payout queue, with the risk signals an approver needs surfaced inline. */
adminRouter.get(
  "/payouts",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "REQUESTED";
    const payouts = await prisma.payoutRequest.findMany({
      where: status === "ALL" ? {} : { status: status as never },
      orderBy: { requestedAt: "asc" },
      take: 100,
      include: {
        user: {
          select: {
            id: true, email: true, fraudScore: true, strikeCount: true, createdAt: true,
            balanceFrozen: true, signupCountry: true,
            _count: { select: { videos: true } },
          },
        },
      },
    });

    // Countable ratio is the headline fraud tell: an account whose views are
    // mostly rejected is farming, whatever its score says.
    const enriched = await Promise.all(
      payouts.map(async (p) => {
        const agg = await prisma.viewRollupHourly.aggregate({
          where: { uploaderId: p.userId },
          _sum: { views: true, countableViews: true },
        });
        const total = Number(agg._sum.views ?? 0n);
        const countable = Number(agg._sum.countableViews ?? 0n);
        return {
          id: p.id,
          amountMicros: p.amountMicros.toString(),
          method: p.method,
          address: p.address,
          status: p.status,
          requestedAt: p.requestedAt,
          fraudScoreAtRequest: p.fraudScoreAtRequest,
          user: {
            id: p.user.id, email: p.user.email, fraudScore: p.user.fraudScore,
            strikeCount: p.user.strikeCount, accountAgeDays: Math.floor((Date.now() - p.user.createdAt.getTime()) / 86400_000),
            videoCount: p.user._count.videos, signupCountry: p.user.signupCountry,
            balanceFrozen: p.user.balanceFrozen,
          },
          signals: {
            totalViews: total,
            countableViews: countable,
            countableRatio: total > 0 ? Math.round((countable / total) * 100) / 100 : null,
          },
        };
      }),
    );

    res.json({ payouts: enriched });
  }),
);

/**
 * Payout decisions. A rejection refunds via a compensating PAYOUT_REVERSAL
 * entry rather than deleting the original debit, so the ledger stays
 * append-only and the attempt remains visible.
 */
adminRouter.post(
  "/payouts/:id/decide",
  asyncHandler(async (req, res) => {
    const decision = req.body?.decision;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 500) : null;
    if (!["APPROVE", "REJECT", "MARK_PAID", "MARK_FAILED"].includes(decision)) {
      throw new HttpError(400, "invalid_decision");
    }

    const payout = await prisma.payoutRequest.findUnique({ where: { id: req.params.id } });
    if (!payout) throw new HttpError(404, "not_found");

    if (decision === "APPROVE") {
      if (payout.status !== "REQUESTED") throw new HttpError(409, "not_pending");
      await prisma.payoutRequest.update({
        where: { id: payout.id },
        data: { status: "APPROVED", reviewerId: req.userId!, decidedAt: new Date(), reviewNotes: notes },
      });
    } else if (decision === "MARK_PAID") {
      if (!["APPROVED", "PROCESSING"].includes(payout.status)) throw new HttpError(409, "not_approved");
      await prisma.payoutRequest.update({
        where: { id: payout.id },
        data: { status: "PAID", paidAt: new Date(), providerRef: typeof req.body?.providerRef === "string" ? req.body.providerRef : null },
      });
    } else {
      // Reject and fail both return the money.
      if (payout.status === "PAID") throw new HttpError(409, "already_paid");
      await prisma.$transaction(async (tx) => {
        await tx.payoutRequest.update({
          where: { id: payout.id },
          data: {
            status: decision === "REJECT" ? "REJECTED" : "FAILED",
            reviewerId: req.userId!, decidedAt: new Date(),
            reviewNotes: notes, failureReason: notes,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            userId: payout.userId,
            type: "PAYOUT_REVERSAL",
            amountMicros: payout.amountMicros,
            refType: "payout_reversal",
            refKey: payout.id,
            description: `Payout ${decision === "REJECT" ? "rejected" : "failed"}: ${notes ?? "no reason given"}`,
            payoutRequestId: payout.id,
          },
        });
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: req.userId!, action: `payout.${decision.toLowerCase()}`,
        targetType: "PayoutRequest", targetId: payout.id,
        metadata: { amountMicros: payout.amountMicros.toString(), notes },
      },
    });

    res.json({ ok: true });
  }),
);

/**
 * Which networks actually pay, by country.
 *
 * This is the report the whole waterfall design exists to enable: revenue per
 * thousand views per network per geo, so underperformers can be reordered or
 * dropped from config rather than guessed at.
 */
adminRouter.get(
  "/networks",
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(req.query.days ?? 7), 90);
    const since = new Date(Date.now() - days * 86400_000);

    const rows = await prisma.$queryRaw<Array<{
      networkId: string; key: string; name: string; slotType: string; country: string | null;
      impressions: bigint; filled: bigint; revenue: bigint;
    }>>`
      SELECT i."networkId", n."key", n."name", n."slotType"::text AS "slotType", i."country",
             COUNT(*)::bigint                                        AS impressions,
             COUNT(*) FILTER (WHERE i."filled")::bigint              AS filled,
             COALESCE(SUM(i."estRevenueMicros"), 0)::bigint          AS revenue
      FROM "AdImpression" i
      JOIN "AdNetwork" n ON n.id = i."networkId"
      WHERE i."createdAt" >= ${since}
      GROUP BY 1,2,3,4,5
      ORDER BY revenue DESC
      LIMIT 200`;

    res.json({
      days,
      // Revenue is an estimate from configured CPMs until the network reports
      // actuals; the console labels it as such.
      estimated: true,
      rows: rows.map((r) => ({
        networkKey: r.key, name: r.name, slotType: r.slotType, country: r.country ?? "XX",
        impressions: r.impressions.toString(),
        filled: r.filled.toString(),
        fillRate: Number(r.impressions) > 0 ? Math.round((Number(r.filled) / Number(r.impressions)) * 100) / 100 : 0,
        estRevenueMicros: r.revenue.toString(),
      })),
    });
  }),
);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { id: q }, { referralCode: q.toUpperCase() }] } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, email: true, status: true, role: true, fraudScore: true, strikeCount: true,
        balanceFrozen: true, createdAt: true, signupCountry: true,
        _count: { select: { videos: true } },
      },
    });

    const withBalances = await Promise.all(
      users.map(async (u) => {
        const b = await getBalances(u.id);
        return {
          ...u,
          videoCount: u._count.videos,
          availableMicros: b.availableMicros.toString(),
          pendingMicros: b.pendingMicros.toString(),
          lifetimeMicros: b.lifetimeMicros.toString(),
        };
      }),
    );
    res.json({ users: withBalances });
  }),
);

adminRouter.post(
  "/users/:id/action",
  asyncHandler(async (req, res) => {
    const action = req.body?.action;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "";
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!user) throw new HttpError(404, "not_found");

    switch (action) {
      case "SUSPEND":
        await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
        break;
      case "REINSTATE":
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "ACTIVE", terminatedAt: null, terminationReason: null, balanceFrozen: false },
        });
        break;
      case "TERMINATE": {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "TERMINATED", terminatedAt: new Date(), terminationReason: reason, balanceFrozen: true },
        });
        const videos = await prisma.video.findMany({
          where: { ownerId: user.id, status: { in: ["READY", "QUEUED", "TRANSCODING"] } },
          select: { id: true },
        });
        for (const v of videos) {
          await takedownVideo({ videoId: v.id, reason: `Owner terminated: ${reason}`, actorId: req.userId!, status: "BLOCKED" });
        }
        break;
      }
      case "FREEZE_BALANCE":
        await prisma.user.update({ where: { id: user.id }, data: { balanceFrozen: true } });
        break;
      case "UNFREEZE_BALANCE":
        await prisma.user.update({ where: { id: user.id }, data: { balanceFrozen: false } });
        break;
      case "CLAWBACK": {
        const amount = BigInt(String(req.body?.amountMicros ?? "0"));
        if (amount <= 0n) throw new HttpError(400, "invalid_amount");
        await clawback({ userId: user.id, amountMicros: amount, reason: reason || "Fraudulent views", actorId: req.userId! });
        break;
      }
      default:
        throw new HttpError(400, "invalid_action");
    }

    await prisma.auditLog.create({
      data: { actorId: req.userId!, action: `user.${String(action).toLowerCase()}`, targetType: "User", targetId: user.id, metadata: { reason } },
    });
    res.json({ ok: true });
  }),
);

/**
 * Quarantine queue: uploads blocked at ingest by the hash list.
 *
 * Access is audited on read, not just on action - who looked at this material
 * and when is itself a record that has to exist.
 */
adminRouter.get(
  "/quarantine",
  asyncHandler(async (req, res) => {
    const videos = await prisma.video.findMany({
      where: { moderation: "QUARANTINED" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, slug: true, title: true, status: true, blockedReason: true, createdAt: true,
        sha256: true, phash: true,
        owner: { select: { id: true, email: true, status: true } },
      },
    });

    await prisma.auditLog.create({
      data: { actorId: req.userId!, action: "quarantine.viewed", targetType: "Video", metadata: { count: videos.length } },
    });

    res.json({ videos });
  }),
);

adminRouter.get(
  "/reports",
  asyncHandler(async (_req, res) => {
    const reports = await prisma.abuseReport.findMany({
      where: { status: "OPEN" },
      // CSAM first regardless of age.
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      take: 100,
      include: { video: { select: { id: true, slug: true, title: true, status: true, posterKey: true, ownerId: true } } },
    });
    res.json({
      reports: reports.map((r) => ({
        ...r,
        video: { ...r.video, poster: r.video.posterKey ? publicUrl(r.video.posterKey) : null },
      })),
    });
  }),
);

adminRouter.post(
  "/reports/:id/resolve",
  asyncHandler(async (req, res) => {
    const action = req.body?.action;
    const resolution = typeof req.body?.resolution === "string" ? req.body.resolution.slice(0, 500) : "";
    const report = await prisma.abuseReport.findUnique({ where: { id: req.params.id }, include: { video: { select: { id: true, ownerId: true } } } });
    if (!report) throw new HttpError(404, "not_found");

    if (action === "REMOVE") {
      await takedownVideo({ videoId: report.videoId, reason: `Abuse report: ${report.category}`, actorId: req.userId!, status: "BLOCKED" });
      await issueStrike({
        userId: report.video.ownerId,
        reason: report.category === "CSAM" || report.category === "ILLEGAL_OTHER" ? "ILLEGAL_CONTENT" : "TOS",
        videoId: report.videoId, actorId: req.userId!, note: resolution,
      });
    }

    await prisma.abuseReport.update({
      where: { id: report.id },
      data: { status: action === "REMOVE" ? "ACTIONED" : "DISMISSED", resolvedAt: new Date(), resolvedById: req.userId!, resolution },
    });
    res.json({ ok: true });
  }),
);

/** Operator policy: content rules, ad density, payout terms. */
adminRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.systemConfig.findMany({ orderBy: { key: "asc" } });
    res.json({ config: rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt })) });
  }),
);

adminRouter.put(
  "/config/:key",
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    if (!key) throw new HttpError(400, "missing_key");
    if (!("value" in (req.body ?? {}))) throw new HttpError(400, "missing_value");
    await setConfig(key, req.body.value);
    await prisma.auditLog.create({
      data: { actorId: req.userId!, action: "config.updated", targetType: "SystemConfig", targetId: key, metadata: { value: req.body.value } },
    });
    res.json({ ok: true, key, value: await getConfig(key, null) });
  }),
);

adminRouter.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
      where: typeof req.query.action === "string" ? { action: req.query.action } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { actor: { select: { email: true } } },
    });
    res.json({ logs });
  }),
);
