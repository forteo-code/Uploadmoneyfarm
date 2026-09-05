import { prisma } from "@dropreel/db";
import { REPEAT_INFRINGER_STRIKE_LIMIT, STRIKE_EXPIRY_DAYS } from "@dropreel/shared";
import { deletePrefix } from "./storage.js";
import { logger } from "./logger.js";

/**
 * Takedown and repeat-infringer enforcement.
 *
 * The strike ledger here is not housekeeping - it is the mechanism the DMCA
 * safe harbour is conditional on. Having a repeat-infringer policy written in
 * the terms is not enough; it has to be enforced, and enforcement has to be
 * evidenced. Every action below writes an AuditLog row for exactly that reason.
 */

/**
 * Removes a video's bytes while keeping its row.
 *
 * The row survives deliberately: takedown notices, strikes and payout records
 * reference it, and destroying that history would undermine the same safe
 * harbour the takedown is meant to preserve.
 */
export async function takedownVideo(params: {
  videoId: string;
  reason: string;
  actorId?: string;
  status?: "DMCA_REMOVED" | "BLOCKED";
}): Promise<void> {
  const status = params.status ?? "DMCA_REMOVED";

  await prisma.video.update({
    where: { id: params.videoId },
    data: { status, visibility: "PRIVATE", blockedReason: params.reason.slice(0, 500) },
  });

  // Bytes go; the CDN still needs purging separately at the edge.
  const removed = await deletePrefix(`hls/${params.videoId}`).catch((err) => {
    logger.error({ err, videoId: params.videoId }, "failed to purge media for takedown");
    return 0;
  });

  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      actorType: params.actorId ? "USER" : "SYSTEM",
      action: `video.${status.toLowerCase()}`,
      targetType: "Video",
      targetId: params.videoId,
      metadata: { reason: params.reason, objectsRemoved: removed },
    },
  });

  logger.info({ videoId: params.videoId, status, objectsRemoved: removed }, "video taken down");
}

/**
 * Records a strike and terminates the account once the limit is reached.
 *
 * Termination is automatic on purpose. A policy that depends on someone
 * remembering to enforce it is the one a court finds was never enforced.
 */
export async function issueStrike(params: {
  userId: string;
  reason: "DMCA" | "ILLEGAL_CONTENT" | "FRAUD" | "TOS";
  videoId?: string;
  noticeId?: string;
  note?: string;
  actorId?: string;
}): Promise<{ strikeCount: number; terminated: boolean }> {
  const expiresAt = new Date(Date.now() + STRIKE_EXPIRY_DAYS * 86400_000);

  await prisma.strike.create({
    data: {
      userId: params.userId,
      reason: params.reason,
      videoId: params.videoId ?? null,
      noticeId: params.noticeId ?? null,
      note: params.note ?? null,
      expiresAt,
    },
  });

  // Only live strikes count: expired and voided ones are excluded, so the
  // policy is "N strikes within the window", not "N ever".
  const active = await prisma.strike.count({
    where: { userId: params.userId, voidedAt: null, expiresAt: { gt: new Date() } },
  });

  await prisma.user.update({ where: { id: params.userId }, data: { strikeCount: active } });

  let terminated = false;
  if (active >= REPEAT_INFRINGER_STRIKE_LIMIT) {
    await prisma.user.update({
      where: { id: params.userId },
      data: {
        status: "TERMINATED",
        terminatedAt: new Date(),
        terminationReason: `Repeat infringer: ${active} active strikes`,
        balanceFrozen: true,
      },
    });
    // Their catalogue goes with them - leaving it up would mean continuing to
    // serve the material the strikes were for.
    const videos = await prisma.video.findMany({
      where: { ownerId: params.userId, status: { in: ["READY", "QUEUED", "TRANSCODING"] } },
      select: { id: true },
    });
    for (const v of videos) {
      await takedownVideo({ videoId: v.id, reason: "Owner terminated as repeat infringer", status: "BLOCKED" });
    }
    terminated = true;
  }

  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      actorType: params.actorId ? "USER" : "SYSTEM",
      action: terminated ? "user.terminated_repeat_infringer" : "user.strike_issued",
      targetType: "User",
      targetId: params.userId,
      metadata: { reason: params.reason, activeStrikes: active, noticeId: params.noticeId ?? null },
    },
  });

  return { strikeCount: active, terminated };
}

/**
 * Clawback for fraudulent views.
 *
 * Written as a compensating entry rather than by deleting the original credit -
 * the ledger stays append-only, so the fact that money was credited and then
 * reversed remains visible to both sides of any dispute.
 */
export async function clawback(params: {
  userId: string;
  amountMicros: bigint;
  reason: string;
  actorId?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        userId: params.userId,
        type: "CLAWBACK",
        amountMicros: -params.amountMicros,
        description: params.reason.slice(0, 500),
        refType: "clawback",
        refKey: `${params.userId}:${Date.now()}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        actorType: params.actorId ? "USER" : "SYSTEM",
        action: "ledger.clawback",
        targetType: "User",
        targetId: params.userId,
        metadata: { amountMicros: params.amountMicros.toString(), reason: params.reason },
      },
    });
  });
}
