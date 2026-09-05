import { Router } from "express";
import { prisma } from "@dropreel/db";
import { dmcaNoticeSchema, counterNoticeSchema, abuseReportSchema, DMCA_SLA_HOURS } from "@dropreel/shared";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import { clientIp } from "../lib/request.js";
import { hashIp } from "../lib/crypto.js";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";

export const dmcaRouter = Router();

/** The designated-agent details a valid notice has to be sent to. */
dmcaRouter.get("/agent", (_req, res) => {
  res.json({
    agent: { name: env.DMCA_AGENT_NAME, email: env.DMCA_AGENT_EMAIL, address: env.DMCA_AGENT_ADDRESS },
    slaHours: DMCA_SLA_HOURS,
  });
});

/**
 * Resolves submitted URLs to videos.
 *
 * Claimants send watch links, embed links or bare slugs interchangeably, so all
 * three are accepted. A URL that resolves to nothing is still recorded against
 * the notice rather than dropped - the notice must be answerable in full, and
 * an unmatched target is itself a fact worth keeping.
 */
function extractSlug(url: string): string | null {
  const match = /\/(?:watch|embed|e|d|v)\/([A-Za-z0-9_-]{6,32})/.exec(url);
  if (match?.[1]) return match[1];
  const bare = /^[A-Za-z0-9_-]{6,32}$/.exec(url.trim());
  return bare ? bare[0] : null;
}

/**
 * Public takedown intake.
 *
 * Deliberately open, unauthenticated and rate-limited rather than gated behind
 * an account: safe harbour depends on notices being easy to send and acted on
 * expeditiously, and a form that deters claimants is a liability, not a defence.
 */
dmcaRouter.post(
  "/notice",
  rateLimit({ windowSeconds: 3600, max: 60, keyPrefix: "dmca_notice" }),
  asyncHandler(async (req, res) => {
    const input = dmcaNoticeSchema.parse(req.body);
    const receivedAt = new Date();
    const dueAt = new Date(receivedAt.getTime() + DMCA_SLA_HOURS * 3600_000);

    const notice = await prisma.dmcaNotice.create({
      data: {
        claimantName: input.claimantName,
        claimantEmail: input.claimantEmail,
        claimantOrg: input.claimantOrg ?? null,
        claimantAddress: input.claimantAddress,
        claimantPhone: input.claimantPhone ?? null,
        workDescription: input.workDescription,
        signature: input.signature,
        goodFaithStatement: input.goodFaithStatement,
        accuracyStatement: input.accuracyStatement,
        receivedAt,
        dueAt,
        sourceIpHash: hashIp(clientIp(req)),
        // The raw submission is retained verbatim: if the notice is ever
        // disputed, what was actually sent is the evidence.
        rawSubmission: input as unknown as object,
      },
      select: { id: true },
    });

    for (const url of input.targetUrls) {
      const slug = extractSlug(url);
      const video = slug
        ? await prisma.video.findUnique({ where: { slug }, select: { id: true } })
        : null;
      await prisma.dmcaTarget.create({
        data: { noticeId: notice.id, url: url.slice(0, 600), videoId: video?.id ?? null },
      });
    }

    logger.warn({ noticeId: notice.id, targets: input.targetUrls.length }, "dmca notice received");

    res.status(201).json({
      noticeId: notice.id,
      receivedAt,
      dueAt,
      message: "Notice received. Targeted material is reviewed and actioned within the stated window.",
    });
  }),
);

/**
 * Counter-notice. Reinstatement is never automatic: the statutory waiting
 * period has to elapse and the operator has to confirm no action was filed, so
 * this only records the counter-notice and flags the original.
 */
dmcaRouter.post(
  "/counter-notice",
  requireAuth,
  rateLimit({ windowSeconds: 3600, max: 20, keyPrefix: "dmca_counter" }),
  asyncHandler(async (req, res) => {
    const input = counterNoticeSchema.parse(req.body);

    const notice = await prisma.dmcaNotice.findUnique({
      where: { id: input.noticeId },
      select: { id: true, status: true },
    });
    if (!notice) throw new HttpError(404, "notice_not_found");

    const counter = await prisma.counterNotice.create({
      data: {
        noticeId: notice.id,
        userId: req.userId!,
        statement: input.statement,
        signature: input.signature,
        address: input.address,
        consentToJurisdiction: input.consentToJurisdiction,
      },
      select: { id: true, submittedAt: true },
    });

    await prisma.dmcaNotice.update({ where: { id: notice.id }, data: { status: "COUNTER_NOTICED" } });

    res.status(201).json({
      counterNoticeId: counter.id,
      submittedAt: counter.submittedAt,
      message: "Counter-notice recorded. The claimant is notified and a statutory waiting period applies before any reinstatement.",
    });
  }),
);

/**
 * Abuse reporting. CSAM reports are logged at error level so they surface in
 * alerting rather than sitting in a queue nobody is watching.
 */
dmcaRouter.post(
  "/report",
  rateLimit({ windowSeconds: 3600, max: 60, keyPrefix: "abuse_report" }),
  asyncHandler(async (req, res) => {
    const input = abuseReportSchema.parse(req.body);

    const video = await prisma.video.findFirst({
      where: { OR: [{ id: input.videoId }, { slug: input.videoId }] },
      select: { id: true },
    });
    if (!video) throw new HttpError(404, "video_not_found");

    const report = await prisma.abuseReport.create({
      data: {
        videoId: video.id,
        category: input.category,
        details: input.details ?? null,
        reporterEmail: input.reporterEmail ?? null,
        reporterIpHash: hashIp(clientIp(req)),
      },
      select: { id: true },
    });

    if (input.category === "CSAM") {
      logger.error({ reportId: report.id, videoId: video.id }, "CSAM REPORT - immediate review required");
    }

    res.status(201).json({ reportId: report.id, message: "Report received." });
  }),
);
