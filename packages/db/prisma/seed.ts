import { PrismaClient, AdSlotType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  tierForCountry,
  TIER_BASELINE_RPM_MICROS,
  TIER_MAX_HEIGHT,
  DEFAULT_REV_SHARE_BPS,
  DEFAULT_MIN_PAYOUT_MICROS,
} from "@dropreel/shared";

const prisma = new PrismaClient();

// Countries we expect meaningful traffic from. Anything not listed falls back
// to the "XX" row, which is tier 3 / 480p - deliberately the cheapest to serve.
const COUNTRIES = [
  "US","CA","GB","AU","NZ","IE","DE","AT","CH","NL","BE","SE","NO","DK","FI","LU","SG","JP","KR",
  "FR","IT","ES","PT","GR","PL","CZ","SK","HU","RO","BG","HR","SI","EE","LV","LT","IL","AE","SA",
  "QA","KW","TW","HK","MY","CL","AR","UY","CR","PA","ZA","TR","MX","BR",
  "IN","ID","PK","BD","PH","VN","TH","NG","EG","MA","DZ","KE","GH","ET","TZ","UG","IQ","IR","UA",
  "RU","KZ","UZ","LK","NP","MM","KH","PE","CO","EC","BO","PY","VE","GT","HN","SV","NI","DO",
];

/**
 * Ad network waterfall.
 *
 * These are the networks that will actually accept unrestricted video
 * inventory. Zone IDs are per-account, so scriptTemplate carries a
 * {{ZONE_ID}} placeholder the operator fills in from the admin console - no
 * real credentials ever live in the repo.
 *
 * priority = tried first (lower number wins). weight = split within a tier.
 * On no-fill the player falls through to the next enabled row, which is the
 * entire point of storing these as data: reordering by observed revenue is a
 * row update, not a deploy.
 */
const AD_NETWORKS: Array<{
  key: string; name: string; slotType: AdSlotType; priority: number; weight: number;
  estCpmMicros: bigint; geoAllow?: string[]; frequencyCapPerHour?: number;
  scriptTemplate?: string; vastTemplate?: string; enabled?: boolean;
}> = [
  // --- Pop-under: the revenue workhorse for this category ---
  {
    key: "exoclick_pop", name: "ExoClick (pop-under)", slotType: "POPUNDER",
    priority: 10, weight: 100, estCpmMicros: 1_800_000n, frequencyCapPerHour: 1,
    scriptTemplate: `<script src="https://a.exdynsrv.com/popunder1000.js" data-zone="{{ZONE_ID}}"></script>`,
  },
  {
    key: "hilltopads_pop", name: "HilltopAds (pop-under)", slotType: "POPUNDER",
    priority: 20, weight: 100, estCpmMicros: 1_400_000n, frequencyCapPerHour: 1,
    scriptTemplate: `<script src="https://{{SUBDOMAIN}}.com/pu.js" data-zone="{{ZONE_ID}}"></script>`,
  },
  {
    key: "popads_pop", name: "PopAds (pop-under)", slotType: "POPUNDER",
    priority: 30, weight: 100, estCpmMicros: 900_000n, frequencyCapPerHour: 1,
    scriptTemplate: `<script>/* PopAds tag, site id {{SITE_ID}} */</script>`,
  },

  // --- Pre-roll: best CPM per impression, costs some viewers ---
  {
    key: "exoclick_vast", name: "ExoClick (VAST pre-roll)", slotType: "PREROLL",
    priority: 10, weight: 100, estCpmMicros: 4_000_000n, frequencyCapPerHour: 4,
    vastTemplate: "https://s.magsrv.com/v1/vast.php?idzone={{ZONE_ID}}",
  },
  {
    key: "trafficjunky_vast", name: "TrafficJunky (VAST pre-roll)", slotType: "PREROLL",
    priority: 20, weight: 100, estCpmMicros: 3_500_000n, frequencyCapPerHour: 4,
    vastTemplate: "https://ads.trafficjunky.net/vast?zone={{ZONE_ID}}",
  },
  {
    key: "adsterra_vast", name: "Adsterra (VAST pre-roll)", slotType: "PREROLL",
    priority: 30, weight: 100, estCpmMicros: 2_000_000n, frequencyCapPerHour: 4,
    vastTemplate: "https://vast.adsterra.com/vast?zone={{ZONE_ID}}",
  },

  // --- Overlay + banner: cheap, low friction, always on ---
  {
    key: "juicyads_overlay", name: "JuicyAds (overlay)", slotType: "OVERLAY",
    priority: 10, weight: 100, estCpmMicros: 500_000n, frequencyCapPerHour: 6,
    scriptTemplate: `<ins class="adsbyjuicy" data-zone="{{ZONE_ID}}"></ins>`,
  },
  {
    key: "exoclick_banner", name: "ExoClick (banner 300x250)", slotType: "BANNER",
    priority: 10, weight: 100, estCpmMicros: 400_000n, frequencyCapPerHour: 12,
    scriptTemplate: `<ins class="eas6a97888e" data-zoneid="{{ZONE_ID}}"></ins>`,
  },
  {
    key: "adsterra_banner", name: "Adsterra (banner)", slotType: "BANNER",
    priority: 20, weight: 100, estCpmMicros: 300_000n, frequencyCapPerHour: 12,
    scriptTemplate: `<script src="//pl.adsterra.net/{{ZONE_ID}}/invoke.js"></script>`,
  },

  // --- Interstitial: real money but the fastest way to lose a viewer.
  // Disabled by default; turn on once you can measure the bounce cost. ---
  {
    key: "clickadu_interstitial", name: "Clickadu (interstitial)", slotType: "INTERSTITIAL",
    priority: 10, weight: 100, estCpmMicros: 1_200_000n, frequencyCapPerHour: 1,
    enabled: false,
    scriptTemplate: `<script src="https://cdn.clickadu.com/i.js" data-zone="{{ZONE_ID}}"></script>`,
  },

  // --- House fallback. Always last, always enabled, never no-fills. Without
  // this a network outage renders an empty hole where the ad should be. ---
  {
    key: "house_fallback", name: "House ad (fallback)", slotType: "BANNER",
    priority: 9999, weight: 1, estCpmMicros: 0n, frequencyCapPerHour: 1000,
    scriptTemplate: `<a href="/upload" class="house-ad">Upload. Get paid. No rules.</a>`,
  },
];

async function main() {
  // ---- Country config: revenue tier AND the quality ceiling it justifies ----
  const countryRows = ["XX", ...COUNTRIES].map((code) => {
    const tier = code === "XX" ? 3 : tierForCountry(code);
    return {
      code,
      tier,
      rpmMicros: TIER_BASELINE_RPM_MICROS[tier],
      maxHeight: TIER_MAX_HEIGHT[tier],
    };
  });
  for (const row of countryRows) {
    await prisma.countryConfig.upsert({
      where: { code: row.code },
      update: { tier: row.tier, rpmMicros: row.rpmMicros, maxHeight: row.maxHeight },
      create: row,
    });
  }
  console.log(`seeded ${countryRows.length} country configs`);

  // ---- Ad networks ----
  for (const n of AD_NETWORKS) {
    await prisma.adNetwork.upsert({
      where: { key: n.key },
      update: {
        name: n.name, slotType: n.slotType, priority: n.priority, weight: n.weight,
        estCpmMicros: n.estCpmMicros, enabled: n.enabled ?? true,
        frequencyCapPerHour: n.frequencyCapPerHour ?? 1,
        scriptTemplate: n.scriptTemplate ?? null, vastTemplate: n.vastTemplate ?? null,
      },
      create: {
        key: n.key, name: n.name, slotType: n.slotType, priority: n.priority, weight: n.weight,
        estCpmMicros: n.estCpmMicros, enabled: n.enabled ?? true,
        frequencyCapPerHour: n.frequencyCapPerHour ?? 1,
        geoAllow: n.geoAllow ?? [],
        scriptTemplate: n.scriptTemplate ?? null, vastTemplate: n.vastTemplate ?? null,
      },
    });
  }
  console.log(`seeded ${AD_NETWORKS.length} ad networks`);

  // ---- Accounts ----
  /**
   * Seed accounts must survive re-running against a database that already has
   * data - including one seeded under a previous set of emails, where the
   * preferred referral code is already taken by an older row. Falls back to a
   * random code rather than failing the whole seed.
   */
  async function ensureUser(opts: {
    email: string; password: string; displayName: string; preferredCode: string; role?: UserRole;
  }) {
    const existing = await prisma.user.findUnique({ where: { email: opts.email }, select: { id: true } });
    if (existing) return existing.id;

    const codeTaken = await prisma.user.findUnique({
      where: { referralCode: opts.preferredCode },
      select: { id: true },
    });
    const referralCode = codeTaken
      ? `${opts.preferredCode.slice(0, 3)}${Math.floor(Math.random() * 900 + 100)}`
      : opts.preferredCode;

    const created = await prisma.user.create({
      data: {
        email: opts.email,
        passwordHash: await bcrypt.hash(opts.password, 10),
        displayName: opts.displayName,
        role: opts.role ?? UserRole.UPLOADER,
        referralCode,
        revShareBps: DEFAULT_REV_SHARE_BPS,
        minPayoutMicros: DEFAULT_MIN_PAYOUT_MICROS,
      },
      select: { id: true },
    });
    return created.id;
  }

  await ensureUser({
    email: "admin@dropreel.local", password: "admin-dev-password",
    displayName: "Admin", preferredCode: "ADMIN0", role: UserRole.ADMIN,
  });
  await ensureUser({
    email: "uploader@dropreel.local", password: "uploader-dev-password",
    displayName: "Demo Uploader", preferredCode: "DEMO01",
  });
  console.log("seeded admin + demo uploader");

  // ---- Operator policy. Content rules live here, not in code, so the
  // operator sets their own line without a deploy. The two compliance
  // switches are intentionally not exposed as togglable. ----
  const config: Array<[string, unknown]> = [
    ["content.allowAdult", true],
    ["content.requireAgeGate", true],
    ["content.blockedCountries", []],
    ["ads.enabled", true],
    ["ads.maxPopundersPerVisitorPerHour", 1],
    // Ad density. These are the revenue/usability dial - raise them and gross
    // impressions rise while fill rate and per-unit CPM fall, so the right
    // values are found by moving them and watching revenue per thousand views,
    // not by picking once.
    ["ads.bannerCount", 20],
    ["ads.stickyFooterEnabled", true],
    ["ads.clickAdEnabled", true],
    ["ads.overlayEnabled", true],
    ["ads.maxClickAdsPerVisitorPerHour", 1],
    // A browsable index is off by default: it turns a neutral file host into a
    // content platform and hands rights holders a catalogue to trawl.
    ["site.publicBrowse", false],
    ["ads.prerollEnabled", true],
    ["payout.holdDays", 30],
    ["payout.minMicros", DEFAULT_MIN_PAYOUT_MICROS.toString()],
    ["payout.revShareBps", DEFAULT_REV_SHARE_BPS],
    ["quality.allow1080p", false],
    ["storage.pruneUnwatchedAfterDays", 90],
  ];
  for (const [key, value] of config) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: value as never },
      create: { key, value: value as never },
    });
  }
  console.log(`seeded ${config.length} system config keys`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
