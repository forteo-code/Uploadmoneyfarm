import { prisma } from "@dropreel/db";

/**
 * Whether a usable database is reachable for the integration tests.
 *
 * The ledger and moderation suites test real database behaviour — transaction
 * scope, row locks, cascading deletes — and there is no honest way to test that
 * against a mock. But a fresh clone has no database, and a suite that fails
 * there teaches contributors to ignore a red test run.
 *
 * So: probe once, and let the suites skip themselves with a visible reason.
 * `npm test` is green everywhere and complete where it can be.
 */
async function probe(): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export const hasDatabase = await probe();

if (!hasDatabase) {
  console.warn(
    "\n  Skipping database integration tests: no database at DATABASE_URL." +
      "\n  Start one with `docker compose up -d postgres` and re-run.\n"
  );
}
