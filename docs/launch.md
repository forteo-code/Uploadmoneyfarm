# Launch runbook

Ordered by what blocks what. Steps 1-3 have waiting periods measured in weeks;
start them before you write a line of config.

## Phase 0 — start the slow things now

These gate everything and none of them are instant.

1. **Payment processing for uploaders.** Stripe and PayPal decline this
   category. Realistic options are crypto (USDT on TRON is the category norm -
   low fees, no chargebacks) plus a specialist processor such as Paxum. Confirm
   you can actually send money before building an audience: a site that cannot
   pay is worse than no site, because it burns the reputation you need.
2. **CSAM hash-matching access.** Apply to Thorn (Safer), the IWF, or NCMEC.
   Vetting takes weeks. The code path is built and waiting for a key; until
   then ingest screening runs against your own list only.
3. **Register a DMCA designated agent** with the US Copyright Office. About $6,
   ten minutes, and it is the cheapest liability reduction available. Put the
   agent details in `DMCA_AGENT_*` so the /dmca page shows them.
4. **Company formation.** Ad networks pay entities, not individuals, and it
   keeps the business's problems separate from yours.

## Phase 1 — infrastructure (a weekend)

| Piece | Choice | Notes |
| --- | --- | --- |
| App server | Small VPS (~$5/mo) | Runs web + API + Postgres + Redis to start |
| Storage | Cloudflare R2 | Zero egress is the whole economic model |
| Encoding | Your own machine at first | No free tier will run FFmpeg for minutes |
| Domain | Registrar that will not fold at the first complaint | ~$10/yr |
| GeoIP | MaxMind GeoLite2 (free) | Without it every viewer is tier 3 |

Do not put the app on a free application host. They forbid heavy video traffic
and several forbid adult content; you would not get a limit warning, you would
get a suspension at exactly the moment it started working.

```bash
git clone <your fork> && cd dropreel
cp .env.example .env          # fill in secrets: openssl rand -hex 32
docker compose up -d postgres redis
npm install
npm run db:migrate && npm run db:seed
npm run build
```

Point the domain at the box, terminate TLS at Cloudflare, and set
`MEDIA_PUBLIC_BASE_URL` to your R2 custom domain.

**Change the seeded admin password immediately.** The seed creates
`admin@dropreel.local` with a known development password.

## Phase 2 — content before advertising

Ad networks will not approve an empty site. You need real uploads and real
traffic first, which means the first phase earns nothing. Plan for that.

Use `npm run ads:demo` while you are here: it serves a complete self-hosted ad
stack so you can tune density (`ads.bannerCount`, the pop-under and click-ad
caps) against how the site actually feels, before any network is involved.

## Phase 3 — monetise

Apply to several networks at once; approval is slow and inconsistent.

- **Pop-under:** ExoClick, HilltopAds, PopAds, Adsterra
- **Pre-roll (VAST):** ExoClick, TrafficJunky, Adsterra
- **Adult-leaning inventory:** ExoClick, TrafficJunky, JuicyAds

Add each as an `AdNetwork` row with its zone id substituted into the template.
Then let the waterfall do its job: after a fortnight the admin console's ad
network report ranks them by revenue per thousand views per country. Reorder by
priority, disable the underperformers. That is a config change, never a deploy.

## Phase 4 — the numbers to watch

Only three matter early:

1. **Revenue per thousand views**, from the admin overview. Everything else is
   downstream of this.
2. **Countable view ratio.** If it falls below roughly half, you are being
   farmed - check the payout queue's inline signals before approving anything.
3. **Bandwidth cost per thousand views.** If it approaches your RPM, lower
   `CountryConfig.maxHeight` for the geos that pay least. The 720p rung is
   about two thirds of delivered bytes.

## Ongoing operations

- **Takedowns within the SLA.** The admin overview shows an alert when a notice
  goes overdue. Missing them is how safe harbour is lost.
- **Never approve a payout without reading the risk signals.** The hold period
  exists so you can be wrong for a month and still claw the money back.
- **Watch storage growth.** Pruning runs automatically every six hours, but
  check that `storage.pruneUnwatchedAfterDays` matches what your margin can
  carry.
