import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@dropreel/db";
import { issueStrike, clawback } from "./moderation.js";
import { getBalances } from "./earnings.js";
import { REPEAT_INFRINGER_STRIKE_LIMIT, STRIKE_EXPIRY_DAYS } from "@dropreel/shared";

/**
 * The repeat-infringer machine.
 *
 * This is the part DMCA safe harbour is conditional on, so it is tested as a
 * state machine rather than trusted to review: strikes accumulate, expired ones
 * stop counting, and the limit terminates automatically.
 */
const createdUserIds: string[] = [];

async function makeUser() {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `mod-test-${suffix}@test.local`,
      passwordHash: "not-a-real-hash",
      referralCode: `MT${suffix.slice(0, 4).toUpperCase()}`,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeVideo(ownerId: string) {
  return prisma.video.create({
    data: {
      ownerId,
      slug: randomUUID().replace(/-/g, "").slice(0, 10),
      title: "strike test",
      status: "READY",
    },
    select: { id: true },
  });
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("repeat infringer policy", () => {
  it("records a strike without terminating on the first offence", async () => {
    const userId = await makeUser();
    const result = await issueStrike({ userId, reason: "DMCA", note: "first" });

    expect(result.strikeCount).toBe(1);
    expect(result.terminated).toBe(false);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, strikeCount: true } });
    expect(user?.status).toBe("ACTIVE");
    expect(user?.strikeCount).toBe(1);
  });

  it("terminates automatically at the limit and takes the catalogue down", async () => {
    const userId = await makeUser();
    const video = await makeVideo(userId);

    let result = { strikeCount: 0, terminated: false };
    for (let i = 0; i < REPEAT_INFRINGER_STRIKE_LIMIT; i++) {
      result = await issueStrike({ userId, reason: "DMCA", note: `strike ${i + 1}` });
    }

    expect(result.strikeCount).toBe(REPEAT_INFRINGER_STRIKE_LIMIT);
    expect(result.terminated).toBe(true);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, terminatedAt: true, balanceFrozen: true },
    });
    expect(user?.status).toBe("TERMINATED");
    expect(user?.terminatedAt).not.toBeNull();
    // The balance freezes too - otherwise a terminated account could withdraw
    // on the way out.
    expect(user?.balanceFrozen).toBe(true);

    // Leaving their videos up would mean continuing to serve the material the
    // strikes were issued for.
    const after = await prisma.video.findUnique({ where: { id: video.id }, select: { status: true, visibility: true } });
    expect(after?.status).toBe("BLOCKED");
    expect(after?.visibility).toBe("PRIVATE");
  });

  it("does not count expired strikes toward the limit", async () => {
    // The policy is N strikes within the window, not N ever - otherwise an
    // account could never recover.
    const userId = await makeUser();

    await prisma.strike.createMany({
      data: Array.from({ length: REPEAT_INFRINGER_STRIKE_LIMIT }, () => ({
        userId,
        reason: "DMCA" as const,
        expiresAt: new Date(Date.now() - 86400_000),
      })),
    });

    const result = await issueStrike({ userId, reason: "DMCA", note: "first live strike" });
    expect(result.strikeCount).toBe(1);
    expect(result.terminated).toBe(false);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    expect(user?.status).toBe("ACTIVE");
  });

  it("does not count voided strikes", async () => {
    const userId = await makeUser();
    const future = new Date(Date.now() + STRIKE_EXPIRY_DAYS * 86400_000);

    await prisma.strike.createMany({
      data: [
        { userId, reason: "DMCA", expiresAt: future, voidedAt: new Date() },
        { userId, reason: "DMCA", expiresAt: future, voidedAt: new Date() },
      ],
    });

    const result = await issueStrike({ userId, reason: "DMCA" });
    expect(result.strikeCount).toBe(1);
    expect(result.terminated).toBe(false);
  });

  it("writes an audit record for every strike", async () => {
    const userId = await makeUser();
    await issueStrike({ userId, reason: "FRAUD", note: "audited" });

    const logs = await prisma.auditLog.findMany({ where: { targetType: "User", targetId: userId } });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.action.startsWith("user."))).toBe(true);
  });
});

describe("clawback", () => {
  it("reverses earnings with a compensating entry, leaving the original intact", async () => {
    const userId = await makeUser();
    await prisma.ledgerEntry.create({
      data: {
        userId, type: "EARNING", amountMicros: 1_000_000n,
        availableAt: new Date(Date.now() - 86400_000),
        refType: "test", refKey: `cb-original-${userId}`,
      },
    });

    await clawback({ userId, amountMicros: 400_000n, reason: "Fraudulent views" });

    const balances = await getBalances(userId);
    expect(balances.availableMicros).toBe(600_000n);

    // The original credit must still be visible - the ledger is append-only,
    // so a dispute can see that money was credited and then reversed.
    const original = await prisma.ledgerEntry.findFirst({
      where: { userId, refKey: `cb-original-${userId}` },
    });
    expect(original).not.toBeNull();
    expect(original?.amountMicros).toBe(1_000_000n);

    const reversal = await prisma.ledgerEntry.findFirst({ where: { userId, type: "CLAWBACK" } });
    expect(reversal?.amountMicros).toBe(-400_000n);
  });
});
