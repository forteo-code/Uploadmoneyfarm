import { prisma, type Prisma } from "@umf/db";
import { applyRevShare, EARNINGS_HOLD_DAYS } from "@umf/shared";
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

  // Hourly rollup is the read model for dashboards and payouts - the raw View
  // table is never aggregated for those. Upsert on the natural key makes a
  // re-run of any backfill safe.
  await tx.viewRollupHourly.upsert({
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
      countableViews: 1n,
      grossMicros,
      uploaderMicros,
    },
    update: {
      views: { increment: 1n },
      countableViews: { increment: 1n },
      grossMicros: { increment: grossMicros },
      uploaderMicros: { increment: uploaderMicros },
    },
  });

  return { grossMicros, uploaderMicros };
}

/** Records a non-countable view in the rollup without paying for it. */
export async function recordUncountedView(params: {
  tx: Prisma.TransactionClient;
  videoId: string;
  uploaderId: string;
  country: string;
  cpmTier: number;
  hourStart: Date;
}): Promise<void> {
  await params.tx.viewRollupHourly.upsert({
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
      countableViews: 0n,
    },
    update: { views: { increment: 1n } },
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
