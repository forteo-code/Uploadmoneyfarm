import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@dropreel/db";
import { getBalances } from "./earnings.js";

/**
 * Database-backed. Requires the dev database (docker compose up postgres).
 * Each test owns a freshly created user so runs never interfere.
 */
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `ledger-test-${suffix}@test.local`,
      passwordHash: "not-a-real-hash",
      referralCode: `LT${suffix.slice(0, 4).toUpperCase()}`,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

const DAY = 86400_000;

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

describe("balances derived from the ledger", () => {
  it("treats a credit inside the hold period as pending, not available", async () => {
    const userId = await makeUser();
    await prisma.ledgerEntry.create({
      data: {
        userId, type: "EARNING", amountMicros: 500_000n,
        availableAt: new Date(Date.now() + 30 * DAY),
        refType: "test", refKey: `hold-${userId}`,
      },
    });

    const balances = await getBalances(userId);
    expect(balances.pendingMicros).toBe(500_000n);
    expect(balances.availableMicros).toBe(0n);
    expect(balances.lifetimeMicros).toBe(500_000n);
  });

  it("makes a credit available once the hold has elapsed", async () => {
    const userId = await makeUser();
    await prisma.ledgerEntry.create({
      data: {
        userId, type: "EARNING", amountMicros: 750_000n,
        availableAt: new Date(Date.now() - DAY),
        refType: "test", refKey: `cleared-${userId}`,
      },
    });

    const balances = await getBalances(userId);
    expect(balances.availableMicros).toBe(750_000n);
    expect(balances.pendingMicros).toBe(0n);
  });

  it("applies debits immediately even though credits wait out the hold", async () => {
    // Otherwise a payout could be requested twice against one balance while
    // the debit sat pending.
    const userId = await makeUser();
    await prisma.ledgerEntry.createMany({
      data: [
        { userId, type: "EARNING", amountMicros: 1_000_000n, availableAt: new Date(Date.now() - DAY), refType: "test", refKey: `e1-${userId}` },
        { userId, type: "PAYOUT", amountMicros: -400_000n, availableAt: new Date(Date.now() + 30 * DAY), refType: "test", refKey: `p1-${userId}` },
      ],
    });

    const balances = await getBalances(userId);
    expect(balances.availableMicros).toBe(600_000n);
    expect(balances.pendingMicros).toBe(0n);
  });

  it("lets a clawback reduce the balance and go negative if warranted", async () => {
    const userId = await makeUser();
    await prisma.ledgerEntry.createMany({
      data: [
        { userId, type: "EARNING", amountMicros: 200_000n, availableAt: new Date(Date.now() - DAY), refType: "test", refKey: `e2-${userId}` },
        { userId, type: "CLAWBACK", amountMicros: -300_000n, refType: "test", refKey: `c1-${userId}` },
      ],
    });

    const balances = await getBalances(userId);
    // Going negative is correct: a debt survives rather than silently vanishing.
    expect(balances.availableMicros).toBe(-100_000n);
  });

  it("counts only genuine earnings toward lifetime, not payouts or clawbacks", async () => {
    const userId = await makeUser();
    await prisma.ledgerEntry.createMany({
      data: [
        { userId, type: "EARNING", amountMicros: 900_000n, availableAt: new Date(Date.now() - DAY), refType: "test", refKey: `l1-${userId}` },
        { userId, type: "REFERRAL", amountMicros: 100_000n, availableAt: new Date(Date.now() - DAY), refType: "test", refKey: `l2-${userId}` },
        { userId, type: "PAYOUT", amountMicros: -500_000n, refType: "test", refKey: `l3-${userId}` },
        { userId, type: "CLAWBACK", amountMicros: -50_000n, refType: "test", refKey: `l4-${userId}` },
      ],
    });

    const balances = await getBalances(userId);
    expect(balances.lifetimeMicros).toBe(1_000_000n);
    expect(balances.availableMicros).toBe(450_000n);
  });

  it("refuses a duplicate credit for the same source event", async () => {
    // This is what makes replaying the earnings job safe: a retried request
    // cannot pay for the same view twice.
    const userId = await makeUser();
    const refKey = `view-${randomUUID()}`;

    await prisma.ledgerEntry.create({
      data: { userId, type: "EARNING", amountMicros: 122n, refType: "view", refKey, availableAt: new Date() },
    });

    await expect(
      prisma.ledgerEntry.create({
        data: { userId, type: "EARNING", amountMicros: 122n, refType: "view", refKey, availableAt: new Date() },
      }),
    ).rejects.toThrow();

    const balances = await getBalances(userId);
    expect(balances.lifetimeMicros).toBe(122n);
  });

  it("sums a realistic volume of sub-cent credits without drift", async () => {
    const userId = await makeUser();
    const past = new Date(Date.now() - DAY);
    await prisma.ledgerEntry.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        userId, type: "EARNING" as const, amountMicros: 122n, availableAt: past,
        refType: "test", refKey: `bulk-${userId}-${i}`,
      })),
    });

    const balances = await getBalances(userId);
    expect(balances.availableMicros).toBe(61_000n);
  });
});
