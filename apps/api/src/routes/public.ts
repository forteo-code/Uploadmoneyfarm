import { Router } from "express";
import { prisma } from "@dropreel/db";
import { applyRevShare, DEFAULT_REV_SHARE_BPS, DEFAULT_MIN_PAYOUT_MICROS } from "@dropreel/shared";
import { asyncHandler } from "../middleware/error.js";
import { getConfig } from "../lib/config.js";
import { env } from "../env.js";

export const publicRouter = Router();

/**
 * Published payout rates.
 *
 * The single most important thing on the landing page: an uploader deciding
 * whether to use the site wants to know what a thousand views pays. Derived
 * from the live CountryConfig tiers and the configured revenue share rather
 * than written into the page, so the advertised rate cannot drift away from
 * what the system actually pays - which would be both a support burden and,
 * eventually, a misrepresentation.
 */
publicRouter.get(
  "/rates",
  asyncHandler(async (_req, res) => {
    const revShareBps = await getConfig<number>("payout.revShareBps", DEFAULT_REV_SHARE_BPS);
    const minPayoutMicros = await getConfig<string>("payout.minMicros", DEFAULT_MIN_PAYOUT_MICROS.toString());
    const holdDays = await getConfig<number>("payout.holdDays", 30);

    const tiers = await prisma.countryConfig.groupBy({
      by: ["tier"],
      _max: { rpmMicros: true },
      orderBy: { tier: "asc" },
    });

    // Representative countries per tier, so the table means something to a
    // reader who does not think in tiers.
    const examples = await Promise.all(
      tiers.map(async (t) => {
        const rows = await prisma.countryConfig.findMany({
          where: { tier: t.tier, code: { not: "XX" } },
          orderBy: { code: "asc" },
          take: 6,
          select: { code: true },
        });
        return { tier: t.tier, codes: rows.map((r) => r.code) };
      }),
    );

    res.json({
      revSharePercent: revShareBps / 100,
      minPayoutMicros,
      holdDays,
      payoutMethods: ["CRYPTO_USDT_TRC20", "CRYPTO_BTC", "PAXUM", "WIRE"],
      tiers: tiers.map((t) => {
        const rpm = t._max.rpmMicros ?? 0n;
        return {
          tier: t.tier,
          // What the uploader receives per 1000 counted views.
          perThousandMicros: applyRevShare(rpm, revShareBps).toString(),
          exampleCountries: examples.find((e) => e.tier === t.tier)?.codes ?? [],
        };
      }),
    });
  }),
);

/** Everything a claimant or reviewer needs without an account. */
publicRouter.get(
  "/site",
  asyncHandler(async (_req, res) => {
    const [allowAdult, ageGate] = await Promise.all([
      getConfig<boolean>("content.allowAdult", true),
      getConfig<boolean>("content.requireAgeGate", true),
    ]);
    res.json({
      dmcaAgent: { name: env.DMCA_AGENT_NAME, email: env.DMCA_AGENT_EMAIL, address: env.DMCA_AGENT_ADDRESS },
      allowAdult,
      ageGate,
    });
  }),
);
