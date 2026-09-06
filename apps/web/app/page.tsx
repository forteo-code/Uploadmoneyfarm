import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { apiBase } from "@/lib/api";

type Rates = {
  revSharePercent: number;
  minPayoutMicros: string;
  holdDays: number;
  tiers: Array<{ tier: number; perThousandMicros: string; exampleCountries: string[] }>;
};

async function getRates(): Promise<Rates | null> {
  try {
    const res = await fetch(`${apiBase()}/api/public/rates`, { next: { revalidate: 300 } });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

function usd(micros: string): string {
  return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

const TIER_LABELS: Record<number, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };

const FAQ = [
  ["What can I upload?", "Anything you have the right to share that is legal where we operate. We do not curate by taste or topic."],
  ["When do I get paid?", "Request a payout once you clear the minimum. Earnings settle after a hold period that protects the pool against view fraud."],
  ["What counts as a view?", "A real person watching. Repeat views from the same visitor, bots and datacentre traffic are not paid."],
  ["Is there a file size limit?", "Up to 5 GB per file, in any common video format."],
  ["Will my videos show up in search?", "No. There is no public index. Your uploads are reachable only by the links you share."],
  ["How do I get paid?", "Crypto (USDT or BTC), Paxum, or bank transfer."],
];

export default async function Home() {
  const rates = await getRates();

  return (
    <>
      <Nav />
      <main className="container">
        <section className="hero">
          <h1 className="hero-title">Upload anything. Get paid per view.</h1>
          <p className="hero-sub">
            Unlimited hosting, fast streaming, and a cut of the ad revenue on every video you upload.
          </p>
          <div className="hero-actions">
            <Link href="/upload"><button className="btn btn-lg">Upload a video</button></Link>
            <Link href="/register" className="hero-link">Create an account</Link>
          </div>
        </section>

        {rates && (
          <section className="rates">
            <div className="rates-head">
              <h2>What you earn</h2>
              <span className="muted">per 1,000 views · {rates.revSharePercent}% revenue share</span>
            </div>
            <div className="rate-cards">
              {rates.tiers.map((t) => (
                <div className="rate-card" key={t.tier}>
                  <span className="rate-tier">{TIER_LABELS[t.tier] ?? `Tier ${t.tier}`}</span>
                  <strong className="rate-amount">{usd(t.perThousandMicros)}</strong>
                  <span className="rate-countries">{t.exampleCountries.slice(0, 5).join(" · ")}</span>
                </div>
              ))}
            </div>
            <p className="muted rates-note">
              Minimum payout {usd(rates.minPayoutMicros)} · earnings clear after {rates.holdDays} days ·
              paid in crypto, Paxum or bank transfer.
            </p>
          </section>
        )}

        <section className="steps">
          <div className="step"><span className="step-n">1</span><div><strong>Upload</strong><p className="muted">Drag in a file. Any common format, up to 5 GB.</p></div></div>
          <div className="step"><span className="step-n">2</span><div><strong>Share</strong><p className="muted">Get a link and an embed code for any site or forum.</p></div></div>
          <div className="step"><span className="step-n">3</span><div><strong>Get paid</strong><p className="muted">Earn on every view. Withdraw whenever you clear the minimum.</p></div></div>
        </section>

        <section className="faq">
          <h2>Questions</h2>
          <div className="faq-grid">
            {FAQ.map(([q, a]) => (
              <div className="faq-item" key={q}>
                <strong>{q}</strong>
                <p className="muted">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="cta-band">
          <div>
            <strong>Ready to start?</strong>
            <p className="muted" style={{ margin: "4px 0 0" }}>No approval process. Upload and you are earning.</p>
          </div>
          <Link href="/upload"><button className="btn btn-lg">Upload a video</button></Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
