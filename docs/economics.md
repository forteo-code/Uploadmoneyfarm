# Unit economics

The two variables that swing this business by an order of magnitude, and what the
architecture does about each.

## Variable 1 - bandwidth per view

A 10-minute clip at 720p is ~0.2 GB watched through. A 90-minute film is ~1.7 GB.
Half-watched, plan on **0.3 GB/view for short content, 0.8 GB/view for long**.

This is the dominant cost. At 10M views/month of movie-length content that is
~8 PB/month, or roughly 25 Gbps sustained.

| Delivery | Cost at 8 PB/month |
| --- | --- |
| AWS S3 + CloudFront (per-GB egress) | catastrophic - multiples of revenue |
| Bunny-class CDN at ~$0.01/GB | ~$80,000 |
| Cloudflare R2 (zero egress) | storage + ops only |
| Unmetered dedicated (~8 boxes) | ~$3,200 |

Verify current pricing before committing - these change, and Cloudflare has
historically scrutinised heavy video delivery outside its Stream product. The
ratio is the point: choose zero-egress or unmetered, never per-GB.

## Variable 2 - blended RPM

Tier 1 traffic (US/UK/DE/CA) pays $3-8 per thousand views with a full ad stack.
Tier 3 (IN/PK/ID/BR) pays $0.30-1.20. This category's traffic skews heavily to
tier 3, so plan on a **blended $1-2**.

## Worked P&L at 10M views/month

Movie-heavy, tier-3-heavy, full ad stack, 35% uploader share:

| Line | Amount |
| --- | --- |
| Ad revenue @ $2.00 RPM | $20,000 |
| Uploader payouts @ 35% | -$7,000 |
| Bandwidth (unmetered dedicated) | -$3,200 |
| Storage, transcode, app servers | -$1,500 |
| **Net** | **~$8,300/mo** |

At 1M views/month the same model nets a few hundred dollars. There is no small
version of this business - margin per view is thin and it only works on volume.

## The levers, ranked by impact

1. **Quality ceiling per geo** (`CountryConfig.maxHeight`). Capping tier 3 at
   480p cuts that view's bandwidth ~60% while losing almost no revenue. Worth
   more than any ad optimisation.
2. **Zero-egress or unmetered delivery.** Decides existence, not margin.
3. **Ad stack depth.** Four slots per view rather than one, with per-geo network
   selection and no-fill fallthrough.
4. **Storage pruning.** Most of the library will never be watched again; it
   accrues cost forever if nothing sweeps it.
5. **Bitrate discipline.** Every 20% off the encoding ladder is 20% off the
   largest line item.

## Risks the code cannot solve

- **Traffic source.** This category's volume comes from embeds on other people's
  sites. Distribution, not features, is the constraint.
- **Payment processing.** Mainstream processors decline this vertical. Budget for
  crypto payouts plus a specialist processor, and confirm it early - it is a hard
  blocker on paying anyone.
- **Host deplatforming.** One abuse complaint at a mainstream provider ends the
  site. DMCA-tolerant hosting costs more and peers worse.
- **View fraud.** Paying per view invites farming. Detection is an arms race; the
  hold period plus clawback is what actually protects the money.
