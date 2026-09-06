import { prisma } from "@dropreel/db";
import { deletePrefix } from "./lib/storage.js";
import { logger } from "./lib/logger.js";

/**
 * Periodic housekeeping.
 *
 * Two of these directly protect margin, and both were config settings with no
 * implementation behind them until now:
 *
 *  - Storage pruning. Most of the library will never be watched again, but it
 *    accrues storage cost every month forever. Sweeping cold videos is the
 *    difference between storage as a rounding error and storage as the second
 *    line item.
 *  - View retention. `View` is the firehose table; keeping it forever makes
 *    every query on it slower and the backups larger, for data whose value has
 *    already been extracted into the hourly rollups.
 */

const HOUR = 3600_000;

async function readConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return (row?.value ?? fallback) as T;
}

/**
 * Deletes the media for READY videos nobody has watched in the configured
 * window. The row is kept and marked so the uploader sees why it stopped
 * playing, and so takedown and payout history stays intact.
 */
export async function pruneColdStorage(): Promise<{ pruned: number; bytesFreed: bigint }> {
  const days = await readConfig<number>("storage.pruneUnwatchedAfterDays", 90);
  if (!days || days <= 0) return { pruned: 0, bytesFreed: 0n };

  const cutoff = new Date(Date.now() - days * 86400_000);

  const cold = await prisma.video.findMany({
    where: {
      status: "READY",
      // Never watched and old enough, or watched but not since the cutoff.
      OR: [
        { lastViewedAt: null, createdAt: { lt: cutoff } },
        { lastViewedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, storageBytes: true },
    take: 200,
  });

  let bytesFreed = 0n;
  for (const video of cold) {
    try {
      await deletePrefix(`hls/${video.id}`);
      await deletePrefix(`source/${video.id}`);
      await prisma.video.update({
        where: { id: video.id },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          blockedReason: `Pruned after ${days} days without views`,
          storageBytes: 0n,
        },
      });
      bytesFreed += video.storageBytes;
    } catch (err) {
      logger.error({ err, videoId: video.id }, "prune failed for video");
    }
  }

  if (cold.length > 0) {
    logger.info({ pruned: cold.length, bytesFreed: bytesFreed.toString() }, "cold storage pruned");
  }
  return { pruned: cold.length, bytesFreed };
}

/**
 * Drops raw view rows past the retention window. The hourly rollups are the
 * permanent record for dashboards, payouts and disputes, so nothing of value is
 * lost - and deleting in batches keeps the transaction short enough not to lock
 * the table against live inserts.
 */
export async function pruneOldViews(): Promise<number> {
  const days = await readConfig<number>("retention.rawViewDays", 90);
  const cutoff = new Date(Date.now() - days * 86400_000);

  let deleted = 0;
  for (let batch = 0; batch < 20; batch++) {
    const result = await prisma.$executeRaw`
      DELETE FROM "View"
      WHERE id IN (SELECT id FROM "View" WHERE "createdAt" < ${cutoff} LIMIT 5000)`;
    deleted += result;
    if (result < 5000) break;
  }
  if (deleted > 0) logger.info({ deleted, days }, "raw views pruned");
  return deleted;
}

/** Expired auth and playback sessions serve no purpose once past their TTL. */
export async function pruneExpiredSessions(): Promise<number> {
  const now = new Date();
  const [auth, playback] = await Promise.all([
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } }),
    // Keep sessions that produced a view: View references them.
    prisma.playbackSession.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400_000) }, view: null },
    }),
  ]);
  const total = auth.count + playback.count;
  if (total > 0) logger.info({ authSessions: auth.count, playbackSessions: playback.count }, "expired sessions pruned");
  return total;
}

export async function runMaintenance(): Promise<void> {
  const started = Date.now();
  try {
    await pruneExpiredSessions();
    await pruneOldViews();
    await pruneColdStorage();
    logger.info({ ms: Date.now() - started }, "maintenance pass complete");
  } catch (err) {
    logger.error({ err }, "maintenance pass failed");
  }
}

/**
 * Started by the worker. Deliberately a simple interval rather than a cron
 * dependency: with more than one worker replica these passes overlap harmlessly
 * (every operation is idempotent and batched), so leader election would be
 * complexity for no benefit at this scale.
 */
export function startMaintenanceLoop(intervalHours = 6): NodeJS.Timeout {
  logger.info({ intervalHours }, "maintenance loop started");
  // First pass shortly after boot, not immediately, so it never competes with
  // startup work.
  setTimeout(() => void runMaintenance(), 5 * 60_000);
  return setInterval(() => void runMaintenance(), intervalHours * HOUR);
}
