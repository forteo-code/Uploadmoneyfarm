# Build Prompt — "Upload Money Farm" video host

Copy everything between the `=== PROMPT START ===` and `=== PROMPT END ===` markers into
Claude Code as your opening message. Notes on why it's written this way are at the bottom.

---

=== PROMPT START ===

You are a senior full-stack engineer. We are building a video hosting and monetization
platform in the mold of Doodstream / MixDrop / Streamtape. Two selling points:

1. **Maximum content freedom** — we accept anything that is legal. No "advertiser-friendly"
   rules, no vague community-guidelines strikes. The only line is the actual law.
2. **Uploaders get paid** — revenue share on ad impressions against their videos, with a
   real dashboard and real payouts.

Monetization is deliberately aggressive: pre-roll, pop-under, overlay banners, interstitial
on play. Mainstream ad networks will not touch this inventory, so every ad integration must
be **network-agnostic and config-driven** — assume we plug in pop-under / redirect / adult /
crypto networks and swap them monthly as they ban us or pay us badly. Never hardcode one
network's script tag.

## Non-negotiable constraints

Build these in from day one, not as a later "compliance phase". They are what keeps the
company alive:

- **Zero-egress-cost delivery.** Storage and CDN must be Cloudflare R2 + Cloudflare CDN.
  Video egress on per-GB-priced object storage (S3, GCS) is an instant bankruptcy at our
  view volumes. Abstract storage behind a `StorageDriver` interface anyway, but R2 is the
  default and the only one we cost-model for.
- **DMCA safe harbor.** Registered agent address in the footer, a public takedown form,
  a takedown queue in admin with an SLA timer, counter-notice flow, and — this is the part
  everyone forgets and it is required for safe harbor — a **repeat infringer policy that
  actually terminates accounts** after N strikes. Log every notice and action immutably.
- **CSAM detection is mandatory and non-optional.** Perceptual-hash every upload against a
  known-bad hash list at ingest, block on match, quarantine, and produce a report record.
  Wire the integration point for a hash-matching provider (PhotoDNA / Safer / equivalent)
  and the NCMEC reporting obligation as a first-class module, even if the provider key is a
  stub in dev. This is not a feature flag.
- **Adult content is a separate legal regime.** If we allow it, we need 18 USC 2257-style
  record-keeping fields on the uploader, an age gate, and geo-blocking for jurisdictions
  with age-verification laws. Build the flags and the per-jurisdiction block list now; leave
  the policy switch to the operator.
- **Payouts are money.** Every earnings mutation goes through an append-only ledger. Never
  `UPDATE users SET balance = ...`. Balance is derived from the ledger.

## Stack

- Next.js (App Router, TypeScript) — public site, watch pages, uploader dashboard, admin
- Node.js + Express (TypeScript) — API, upload, tracking, payouts
- PostgreSQL + Prisma
- Redis + BullMQ — transcode queue, view dedupe, rate limits
- FFmpeg workers (separate container, horizontally scalable) — HLS ladder + thumbnails
- Cloudflare R2 (storage) behind Cloudflare CDN, signed URLs on segments
- hls.js in a custom HTML5 player (no third-party player — we need control of the ad slots)

Monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/db`, `packages/shared`.
Docker Compose for local dev (postgres, redis, minio-as-R2-stand-in, api, worker, web).

## Build order

Work in phases. **Finish and show me each phase before starting the next.** Do not scaffold
all forty files at once — I want working vertical slices.

### Phase 1 — Schema and foundations
Design and write the Prisma schema. At minimum:

- `User` — auth, role (uploader/admin), payout method, KYC/2257 fields, strike count,
  `terminatedAt`, referral code
- `Video` — owner, slug, title, visibility, status (`uploading|queued|transcoding|ready|
  blocked|dmca_removed`), duration, source object key, HLS manifest key, poster/sprite keys,
  content flags (adult, sensitive), hash fingerprints (perceptual + sha256)
- `VideoVariant` — per-rendition (resolution, bitrate, key, size)
- `View` — video, timestamp, hashed IP+UA, country, ASN, referrer, watch-seconds,
  `isCountable`, `fraudReasons[]`, `cpmTier`
- `AdImpression` — view, slot, network, payout estimate
- `LedgerEntry` — user, videoId?, type (`earning|adjustment|clawback|payout|referral`),
  amountMicros (bigint, never float), currency, sourceRef, createdAt. **Append-only.**
- `PayoutRequest` — user, amount, method, status, provider ref, reviewer, notes
- `DmcaNotice` — claimant, contact, sworn statement, target videos, status, receivedAt,
  actionedAt, counterNoticeId
- `Strike` / `AbuseReport` / `AuditLog`

Explain your indexing choices for the views table specifically — it will be the largest
table by two orders of magnitude, and I want to know your partitioning/rollup plan
(hint: raw views hot table + hourly rollup table, and the dashboard reads rollups).

Then: migrations, seed script, and the Docker Compose dev environment. Show me `docker
compose up` working before moving on.

### Phase 2 — Upload and transcode pipeline
- Direct-to-R2 multipart upload with presigned URLs (the API never proxies video bytes)
- Resumable chunked upload, client-side progress, per-user quota + concurrency limits
- On complete: enqueue a transcode job
- Worker: ffprobe the source, reject malformed/mismatched containers, sha256 + perceptual
  hash, hash-list check (block path), then encode an HLS ladder (240/360/480/720/1080,
  skip renditions above source), generate poster + a webvtt thumbnail sprite sheet
- Idempotent jobs, retries with backoff, dead-letter queue, per-job structured logs
- Storage abstraction + signed playback URLs with short TTL and a referrer/token check so
  our segments can't be hotlinked into someone else's ad-free player

### Phase 3 — Player and watch page
Custom React player over hls.js:
- Quality selector, speed, seek preview from the sprite sheet, keyboard shortcuts, mobile
  fullscreen, resume-from-position
- **An `AdSlot` component and an ad-network registry.** Networks are rows in config:
  `{ id, name, slotType, scriptTemplate, frequencyCap, geoAllow, geoDeny, enabled, weight }`.
  Slot types: `preroll`, `midroll`, `overlay`, `banner_below`, `popunder_on_play`,
  `interstitial_on_click`. The player fires slot lifecycle events; the registry decides which
  network fills each slot, weighted, with frequency capping per visitor per hour.
- Ship a **house-ad fallback** for every slot so the page never renders a hole when a
  network 404s, and an `adblockDetected` signal that swaps to a fallback layout.
- Yes, this is aggressive by design — but cap it: at most one pop-under per visitor per hour
  and no interstitial on the same click that starts playback. A player that is genuinely
  unusable loses the view before the impression counts, which loses us the money. Make the
  caps config values, not opinions baked into code.

### Phase 4 — View tracking and anti-fraud
This is the module that decides whether we make money or get farmed, so treat it as the
hard problem it is. A view counts only when **all** of these hold:

- Watch-time threshold met (default 30s or 30% of duration, whichever is lower), reported by
  heartbeat pings from the player, not by a single fire-and-forget beacon
- Heartbeat cadence is plausible (no 10 pings in 2 seconds; monotonic playback position)
- Request is signed with a short-lived, single-use token issued per playback session, bound
  to the video id and the session — replaying the tracking endpoint must be useless
- Dedupe on `hash(ip + userAgent + videoId)` within a rolling window (default 24h) in Redis
- Not from a datacenter/VPN/proxy ASN, not a known bot UA, not headless-browser fingerprinted
- Referrer and country recorded; CPM tier resolved from a country→tier table (this is why
  tier-1 traffic pays multiples of tier-3, and uploaders will ask)

Non-countable views still get stored with their `fraudReasons` — we need the data to tune,
and we need it to defend an uploader dispute. Add:
- A per-uploader fraud score and a **hold period** (earnings pend for N days before becoming
  withdrawable) so we can claw back before the money leaves
- A clawback ledger entry type, and an admin view of "suspicious earners"
- Rate limits at the edge, not just the app

Assume a determined adversary with a residential proxy pool. Write down in a comment what
your design does *not* stop, so we know where we stand.

### Phase 5 — Uploader dashboard
Earnings over time (from the rollup tables), per-video breakdown, views by country and CPM
tier, pending vs available balance with the hold period explained in plain language, payout
request flow with minimum threshold and method selection, referral program, and an embed-code
generator (iframe + direct link) since embeds are where this kind of site actually gets traffic.

### Phase 6 — Admin and compliance console
DMCA queue with SLA countdown and one-click takedown that propagates to CDN cache purge;
counter-notice handling; strike/termination workflow; abuse report triage; the CSAM
quarantine queue with a restricted-access audit trail; user search, ban, and balance freeze;
payout approval queue with fraud signals surfaced inline; ad network performance comparison
(revenue per 1000 views by network and geo) so we can drop the ones that underpay; and a
global content-policy config (what's allowed, what's geo-blocked, what's age-gated).

### Phase 7 — Hardening
Rate limiting, CSRF, signed cookies, virus scan on non-video uploads, CSP that tolerates our
ad scripts without opening XSS wide, structured logging, Sentry, cost dashboards
(storage GB, transcode minutes, requests) per video so we can find and prune the videos that
cost more than they earn, and a documented runbook for "our host just forwarded us a legal
threat".

## Working rules

- TypeScript strict. Zod at every boundary. No `any`.
- Tests for the money paths: view countability, ledger arithmetic, payout state machine,
  DMCA state machine. I don't need 100% coverage; I need those four to be provably right.
- Money is `bigint` micros. No floats anywhere near a balance.
- Every admin action writes an `AuditLog` row.
- Secrets from env, `.env.example` committed, never a real key in the repo.
- If a decision has a real trade-off (partitioning strategy, HLS vs DASH, hold-period length),
  state the options and your recommendation in one short paragraph, pick one, and move on.
  Don't stop and ask unless it's genuinely blocking.

Start with Phase 1: the full Prisma schema with your indexing and rollup plan for `View`,
then the Docker Compose dev environment. Show me both, then stop and wait.

=== PROMPT END ===

---

## Why the prompt is shaped this way

**Phased, with stop points.** A single "generate the whole platform" prompt produces forty
plausible files that don't run together. Vertical slices you can actually boot are worth more.

**Ad networks as config, not code.** The networks that will accept this inventory also drop
publishers without warning, change payout terms, and occasionally serve malware. A registry
table means swapping one is a config change, not a refactor of the player.

**The economics, bluntly.** Egress is the whole business model. A 10-minute 720p view is
roughly 300–500 MB. At a typical per-GB egress price on S3-class storage, a thousand views
of that video costs more in bandwidth than the ads on it will ever earn — the model is
underwater on arrival. Cloudflare R2's zero egress fee is what makes the thing possible at
all; storage and operations are then a rounding error by comparison. Check current pricing
yourself before committing, but the ratio is the point: pick zero-egress or don't start.

**Fraud is the second business model risk.** Paying per view creates a direct incentive to
manufacture views, and the people who show up first for a "get paid per view, anything goes"
site are precisely the ones with proxy pools. Hold periods and clawbacks matter more than
detection cleverness, because they let you be wrong for a few days and still recover.

**Compliance isn't ornamental.** The prompt puts hash-scanning and the repeat-infringer
policy in the constraints section on purpose. Safe harbor is what stands between "we host
user uploads" and "we are liable for user uploads," and it is conditional on having and
enforcing a termination policy. The CSAM scanning obligation is not something a permissive
content policy can opt out of — a maximum-freedom site attracts exactly the traffic that
makes this the thing that ends the company if it's missing.

**The realistic hurdles the code can't solve:** a host that won't drop you at the first
abuse complaint (offshore/DMCA-tolerant providers cost more and peer worse), a payment
processor willing to send money to your uploaders (mainstream PSPs decline this category —
expect crypto and a handful of specialist processors), and the point where your ad revenue
per thousand views exceeds your delivery cost per thousand views. Model that last number
before you write a line of code; every other decision follows from it.

## Open decision

Which ad network(s) are you actually planning to run? The registry design above works with
any of them, but knowing whether you're aiming at pop-under networks, adult networks, or
crypto/gambling feeds changes the CPM tier table, the geo strategy, and whether you need the
2257 module switched on from day one.
