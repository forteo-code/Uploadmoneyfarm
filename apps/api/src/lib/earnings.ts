import { prisma, type Prisma } from "@dropreel/db";
import { applyRevShare, EARNINGS_HOLD_DAYS } from "@dropreel/shared";
import { getConfig } from "./config.js";

/**
 * Credits a countable view.
 *
 * Two invariants hold here and are worth stating:
 *
 *  1. Money only ever enters the system as a LedgerEntry row. Balances are
 *     derived by summing the ledger, never stored, so there is no field for a
 *     concurrent write to corrupt and every cent has a traceable origin.
 *  2. The write is idempotent on (refType, refKey) = ("view", viewId). Replaying
 *     the earnings job, or a retried request, cannot pay twice - the unique
 *     index rejects the duplicate rather than relying on the caller being
 *     careful.
 *
 * availableAt implements the hold period. Earnings are visible to the uploader
 * immediately but not withdrawable until it passes, which is the window in
 * which fraud discovered after the fact can still be clawed back.
 */
export async function creditView(params: {
  tx: Prisma.TransactionClient;
  viewId: bigint;
  videoId: string;
  uploaderId: string;
  country: string;
  cpmTier: number;
  hourStart: Date;
  revShareBps: number;
  rpmMicros: bigint;
}): Promise<{ grossMicros: bigint; uploaderMicros: bigint }> {
  const { tx } = params;
  // NOTE: this writes only the ledger row. Rollup and counter updates are
  // deliberately NOT here - see applyViewAggregates below for why.

  // RPM is revenue per 1000 views, so one view is a thousandth of it.
  const grossMicros = params.rpmMicros / 1000n;
  const uploaderMicros = applyRevShare(grossMicros, params.revShareBps);

  const holdDays = await getConfig<number>("payout.holdDays", EARNINGS_HOLD_DAYS);
  const availableAt = new Date(Date.now() + holdDays * 86400_000);

  if (uploaderMicros > 0n) {
    await tx.ledgerEntry.create({
      data: {
        userId: params.uploaderId,
        type: "EARNING",
        amountMicros: uploaderMicros,
        videoId: params.videoId,
        refType: "view",
        refKey: params.viewId.toString(),
        description: `View credit (${params.country}, tier ${params.cpmTier})`,
        availableAt,
      },
    });
  }

  return { grossMicros, uploaderMicros };
}

/**
 * Applies the derived aggregates for a view: the hourly rollup and the
 * denormalised counters on Video.
 *
 * Deliberately OUTSIDE the crediting transaction. Every viewer of the same
 * video contends on the same Video row and the same (video, hour, country)
 * rollup row, so holding those locks for the life of an interactive
 * transaction serialises concurrent viewers behind each other - under real
 * concurrency that produced Prisma P2028 timeouts and silently dropped views
 * along with the revenue attached to them, precisely when a video got popular.
 *
 * Run as individual statements the row locks are held for microseconds instead.
 * These are safe to separate because they are derived data, not the source of
 * truth: LedgerEntry is authoritative for money, and ViewRollupHourly can be
 * rebuilt from the View table if a process dies mid-write.
 */
export async function applyViewAggregates(params: {
  videoId: string;
  uploaderId: string;
  country: string;
  cpmTier: number;
  hourStart: Date;
  countable: boolean;
  grossMicros: bigint;
  uploaderMicros: bigint;
  viewedAt: Date;
}): Promise<void> {
  const { countable } = params;

  await prisma.viewRollupHourly.upsert({
    where: {
      videoId_hourStart_country: {
        videoId: params.videoId,
        hourStart: params.hourStart,
        country: params.country,
      },
    },
    create: {
      videoId: params.videoId,
      uploaderId: params.uploaderId,
      hourStart: params.hourStart,
      country: params.country,
      cpmTier: params.cpmTier,
      views: 1n,
      countableViews: countable ? 1n : 0n,
      grossMicros: countable ? params.grossMicros : 0n,
      uploaderMicros: countable ? params.uploaderMicros : 0n,
    },
    update: {
      views: { increment: 1n },
      ...(countable
        ? {
            countableViews: { increment: 1n },
            grossMicros: { increment: params.grossMicros },
            uploaderMicros: { increment: params.uploaderMicros },
          }
        : {}),
    },
  });

  await prisma.video.update({
    where: { id: params.videoId },
    data: {
      viewCount: { increment: 1n },
      lastViewedAt: params.viewedAt,
      ...(countable
        ? { countableViewCount: { increment: 1n }, earnedMicros: { increment: params.uploaderMicros } }
        : {}),
    },
  });
}

/**
 * Withdrawable balance: credits past their hold, minus everything already paid
 * or clawed back. Derived on read, never cached in a column.
 */
export async function getBalances(userId: string): Promise<{
  availableMicros: bigint;
  pendingMicros: bigint;
  lifetimeMicros: bigint;
}> {
  const now = new Date();
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId },
    select: { amountMicros: true, availableAt: true, type: true },
  });

  let available = 0n;
  let pending = 0n;
  let lifetime = 0n;

  for (const e of entries) {
    if (e.type === "EARNING" || e.type === "REFERRAL") lifetime += e.amountMicros;
    // A debit (payout, clawback) always applies immediately; only credits wait
    // out the hold.
    if (e.amountMicros < 0n || !e.availableAt || e.availableAt <= now) available += e.amountMicros;
    else pending += e.amountMicros;
  }

  return { availableMicros: available, pendingMicros: pending, lifetimeMicros: lifetime };
}

export function floorToHour(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}
