# Dropreel

A video host where the uploader is the customer. Upload a file, get a link and an
embed code, earn a share of the ad revenue on every countable view.

Content policy is set by the operator in the admin console, not hardcoded. The
only two things the codebase enforces unconditionally are the ones that are not
negotiable in law: perceptual-hash screening at ingest, and DMCA notice handling
with a working repeat-infringer policy.

## Why it is built this way

**Egress pricing decides whether this business exists.** A movie-length view costs
roughly 0.8 GB to deliver. At per-GB cloud egress rates that is multiples of what
the ads on that view earn, so the platform is underwater on arrival. The design
targets zero-egress object storage (Cloudflare R2) or unmetered dedicated
bandwidth, and the storage layer is an S3-compatible driver so either works.

**Delivery quality is matched to what the geo pays.** `CountryConfig.maxHeight`
caps the ladder per country: tier 3 gets 480p, tier 1 and 2 get 720p, and 1080p
is off everywhere by default. Serving 720p to traffic worth $0.35 RPM burns more
bandwidth than the ads return. This is the single largest margin lever in the
product and it is a config table, tunable against real revenue data.

**Ad networks are data, not code.** Networks that accept unrestricted video
inventory drop publishers without warning. The player asks the server which
network fills each slot for the viewer's country; the server runs a weighted
waterfall over `AdNetwork` rows and falls through on no-fill to a house ad, so a
slot is never an empty hole. Swapping or reordering networks is a row update.

**Balances are derived, never stored.** Every cent is a row in an append-only
`LedgerEntry`. Earnings carry an `availableAt` hold so fraud found weeks later
can still be clawed back before money leaves.

**Views are earned, not claimed.** The player heartbeats its playback position
against a server-issued, single-use, session-bound token. Replaying the tracking
endpoint is useless. Non-countable views are still stored with their
`fraudReasons` - that is the evidence trail for payout disputes.

## Layout

```
packages/shared   money (BigInt micros), geo tiers, encoding ladder, zod schemas
packages/db       Prisma schema, migrations, seed
apps/api          Express: auth, upload, playback, tracking, payouts, admin
apps/worker       BullMQ + FFmpeg: probe, fingerprint, hash-check, HLS ladder
apps/web          Next.js: watch pages, embed player, dashboards, admin
```

## Quickstart

```bash
cp .env.example .env          # then set the secrets
docker compose up -d          # postgres, redis, minio (stands in for R2)
npm install
npm run db:migrate
npm run db:seed
npm run dev:api               # :4000
npm run dev:worker
npm run dev:web               # :3000
```

Seeded logins are in `packages/db/prisma/seed.ts` and are development-only.

## Operational notes

- `View` is the firehose table. Dashboards and payouts read `ViewRollupHourly`,
  never raw views. Partition `View` by month once volume warrants it and drop old
  partitions rather than deleting rows; raw retention is 90 days, rollups are
  kept indefinitely.
- Storage grows faster than revenue. `storage.pruneUnwatchedAfterDays` sweeps
  READY videos nobody has watched, using the `lastViewedAt` index.
- Ad zone IDs are per-account and live in the database, never in the repo.
  `scriptTemplate` carries `{{ZONE_ID}}` placeholders filled in from admin.

See `docs/economics.md` for the unit-economics model this design is built around.
