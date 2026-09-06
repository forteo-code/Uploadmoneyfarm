import type { AdSlotType } from "@dropreel/db";
import { prisma } from "@dropreel/db";
import { redis } from "./redis.js";
import { getConfig } from "./config.js";

/**
 * Ad selection is a per-slot waterfall.
 *
 * Networks that accept unrestricted video inventory no-fill constantly and drop
 * publishers without warning, so a single hardcoded tag is a guaranteed revenue
 * hole. The server returns an ordered list per slot; the player walks it and
 * stops at the first fill. Reordering by observed revenue, or dropping a
 * network that banned us, is a row update in AdNetwork.
 */

export type AdPlacement = {
  networkKey: string;
  networkId: string;
  name: string;
  kind: "script" | "vast";
  payload: string;
  estCpmMicros: string;
};

export type AdPlan = Record<string, AdPlacement[]>;

/**
 * How many units of each slot the page should render, and which behavioural
 * slots are armed.
 *
 * Density is operator config rather than a constant because the right number is
 * an empirical question, not a design one: more units raise gross impressions
 * but depress fill rate and per-unit CPM (networks price by viewability, and
 * the twentieth banner below the fold is rarely viewable), while adding page
 * weight that costs bandwidth on every view. The only way to find the peak is
 * to move the number and watch revenue per thousand views, so the number is a
 * knob.
 */
export type AdLayout = {
  bannerCount: number;
  stickyFooter: boolean;
  clickAd: boolean;
  overlay: boolean;
};

export async function getAdLayout(): Promise<AdLayout> {
  const [bannerCount, stickyFooter, clickAd, overlay] = await Promise.all([
    getConfig<number>("ads.bannerCount", 20),
    getConfig<boolean>("ads.stickyFooterEnabled", true),
    getConfig<boolean>("ads.clickAdEnabled", true),
    getConfig<boolean>("ads.overlayEnabled", true),
  ]);
  return {
    // Hard ceiling: beyond this the page stops being usable at all, at which
    // point the viewer leaves before any impression is registered.
    bannerCount: Math.max(0, Math.min(bannerCount, 40)),
    stickyFooter,
    clickAd,
    overlay,
  };
}

const SLOTS: AdSlotType[] = ["PREROLL", "POPUNDER", "OVERLAY", "BANNER", "INTERSTITIAL"];

function hourBucket(d = new Date()): string {
  return `${d.toISOString().slice(0, 13)}`;
}

/**
 * Weighted shuffle within a priority band. Networks at the same priority get
 * split by weight, which is how you A/B two networks against each other without
 * a code change; distinct priorities are strict fallback order.
 */
function weightedOrder<T extends { priority: number; weight: number }>(rows: T[]): T[] {
  const byPriority = new Map<number, T[]>();
  for (const row of rows) {
    const bucket = byPriority.get(row.priority) ?? [];
    bucket.push(row);
    byPriority.set(row.priority, bucket);
  }

  const out: T[] = [];
  for (const priority of [...byPriority.keys()].sort((a, b) => a - b)) {
    const bucket = [...(byPriority.get(priority) ?? [])];
    while (bucket.length > 0) {
      const total = bucket.reduce((sum, r) => sum + Math.max(1, r.weight), 0);
      let pick = Math.random() * total;
      let index = 0;
      for (let i = 0; i < bucket.length; i++) {
        pick -= Math.max(1, bucket[i]!.weight);
        if (pick <= 0) {
          index = i;
          break;
        }
      }
      out.push(bucket.splice(index, 1)[0]!);
    }
  }
  return out;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Per-visitor frequency capping.
 *
 * This is where restraint is actually profitable rather than merely polite: a
 * player that pops three windows loses the viewer before the pre-roll
 * impression registers, so the caps protect revenue as much as they protect the
 * viewer. Counters are advisory - they increment when the plan is issued, not
 * when an impression is confirmed - which errs toward under-serving.
 */
async function isCapped(visitorHash: string, networkKey: string, cap: number): Promise<boolean> {
  if (cap <= 0) return true;
  const key = `adcap:${visitorHash}:${networkKey}:${hourBucket()}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3700);
    return count > cap;
  } catch {
    // Redis down: serve the ad rather than losing the impression.
    return false;
  }
}

export async function buildAdPlan(opts: {
  visitorHash: string;
  country: string | null;
  videoId: string;
  isBot: boolean;
}): Promise<AdPlan> {
  const adsEnabled = await getConfig<boolean>("ads.enabled", true);
  // Never serve ads to something we already believe is a bot: the impression is
  // worthless, and networks penalise publishers for invalid traffic.
  if (!adsEnabled || opts.isBot) return {};

  const prerollEnabled = await getConfig<boolean>("ads.prerollEnabled", true);
  const popCap = await getConfig<number>("ads.maxPopundersPerVisitorPerHour", 1);
  // The client also remembers this, but localStorage is trivially cleared, so
  // the authoritative cap has to live here.
  const clickCap = await getConfig<number>("ads.maxClickAdsPerVisitorPerHour", 1);

  const country = (opts.country ?? "").toUpperCase();

  // Demo mode swaps the whole stack for self-hosted placeholder inventory, so
  // the operator can see and tune the real viewer experience before any network
  // has approved them. It is exclusive: demo and live inventory never mix.
  const demoMode = await getConfig<boolean>("ads.demoMode", false);

  const networks = await prisma.adNetwork.findMany({
    where: {
      enabled: true,
      ...(demoMode ? { key: { startsWith: "demo_" } } : { key: { not: { startsWith: "demo_" } } }),
    },
    select: {
      id: true, key: true, name: true, slotType: true, priority: true, weight: true,
      scriptTemplate: true, vastTemplate: true, geoAllow: true, geoDeny: true,
      frequencyCapPerHour: true, estCpmMicros: true,
    },
  });

  const plan: AdPlan = {};

  for (const slot of SLOTS) {
    if (slot === "PREROLL" && !prerollEnabled) continue;

    const eligible = networks.filter((n) => {
      if (n.slotType !== slot) return false;
      if (country) {
        if (n.geoDeny.includes(country)) return false;
        if (n.geoAllow.length > 0 && !n.geoAllow.includes(country)) return false;
      } else if (n.geoAllow.length > 0) {
        // Unknown country cannot satisfy an allow-list, so skip rather than
        // guess - a mis-targeted impression is worth nothing anyway.
        return false;
      }
      return true;
    });

    const ordered = weightedOrder(eligible);
    const placements: AdPlacement[] = [];

    for (const n of ordered) {
      const cap =
        slot === "POPUNDER" ? Math.min(n.frequencyCapPerHour, popCap)
        : slot === "INTERSTITIAL" ? Math.min(n.frequencyCapPerHour, clickCap)
        : n.frequencyCapPerHour;
      if (await isCapped(opts.visitorHash, n.key, cap)) continue;

      const vars = { COUNTRY: country || "XX", VIDEO_ID: opts.videoId, SLOT: slot };
      if (n.vastTemplate) {
        placements.push({
          networkKey: n.key, networkId: n.id, name: n.name, kind: "vast",
          payload: renderTemplate(n.vastTemplate, vars),
          estCpmMicros: n.estCpmMicros.toString(),
        });
      } else if (n.scriptTemplate) {
        placements.push({
          networkKey: n.key, networkId: n.id, name: n.name, kind: "script",
          payload: renderTemplate(n.scriptTemplate, vars),
          estCpmMicros: n.estCpmMicros.toString(),
        });
      }
    }

    if (placements.length > 0) plan[slot] = placements;
  }

  return plan;
}
