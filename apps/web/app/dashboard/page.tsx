"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { authFetch, formatMicros, formatMicrosPrecise } from "@/lib/auth";

type Earnings = {
  balances: { availableMicros: string; pendingMicros: string; lifetimeMicros: string };
  account: {
    revShareBps: number; minPayoutMicros: string; payoutMethod: string | null;
    payoutAddress: string | null; referralCode: string; hasPendingPayout: boolean;
  };
  daily: Array<{ day: string; views: string; countableViews: string; earnedMicros: string }>;
  byCountry: Array<{ country: string; countableViews: string; earnedMicros: string }>;
  topVideos: Array<{ id: string; slug: string; title: string; poster: string | null; views: string; countableViews: string; earnedMicros: string }>;
};

type Payout = {
  id: string; amountMicros: string; method: string; status: string;
  requestedAt: string; paidAt: string | null; failureReason: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Earnings | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch("/api/me/earnings");
    if (res.status === 401) { setAuthed(false); return; }
    setAuthed(true);
    if (res.ok) setData(await res.json());
    const pr = await authFetch("/api/me/payouts");
    if (pr.ok) setPayouts((await pr.json()).payouts ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (authed === false) {
    return (
      <>
        <Nav />
        <main className="container narrow">
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Sign in</h1>
            <button className="btn btn-lg" onClick={() => router.push("/login")}>Sign in</button>
          </div>
        </main>
      </>
    );
  }

  if (!data) {
    return (<><Nav /><main className="container"><p className="muted">Loading…</p></main></>);
  }

  const available = BigInt(data.balances.availableMicros);
  const minimum = BigInt(data.account.minPayoutMicros);
  const canRequest = available >= minimum && !data.account.hasPendingPayout && !!data.account.payoutAddress;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function requestPayout() {
    setNotice(null);
    const res = await authFetch("/api/me/payouts", {
      method: "POST",
      body: JSON.stringify({
        amountMicros: available.toString(),
        method: data!.account.payoutMethod ?? "CRYPTO_USDT_TRC20",
        address: data!.account.payoutAddress,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setNotice(res.ok ? "Payout requested. It will be reviewed before sending." : `Could not request payout: ${body.error ?? res.status}`);
    void load();
  }

  return (
    <>
      <Nav />
      <main className="container">
        <h1>Dashboard</h1>

        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">Available now</span>
            <strong className="stat-value">{formatMicros(data.balances.availableMicros)}</strong>
            <span className="muted">withdrawable</span>
          </div>
          <div className="stat">
            <span className="stat-label">Pending</span>
            <strong className="stat-value">{formatMicros(data.balances.pendingMicros)}</strong>
            <span className="muted">clears after the 30-day hold</span>
          </div>
          <div className="stat">
            <span className="stat-label">Lifetime earned</span>
            <strong className="stat-value">{formatMicros(data.balances.lifetimeMicros)}</strong>
            <span className="muted">{(data.account.revShareBps / 100).toFixed(0)}% revenue share</span>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>Payouts</h3>
          {!data.account.payoutAddress ? (
            <p className="muted">Set a payout address before you can withdraw.</p>
          ) : (
            <p className="muted">
              Paying to <code>{data.account.payoutMethod}</code> ·{" "}
              <code>{data.account.payoutAddress.slice(0, 18)}…</code> · minimum{" "}
              {formatMicros(data.account.minPayoutMicros)}
            </p>
          )}
          <button className="btn" disabled={!canRequest} onClick={() => void requestPayout()}>
            {data.account.hasPendingPayout ? "Payout pending" : `Withdraw ${formatMicros(data.balances.availableMicros)}`}
          </button>
          {!canRequest && !data.account.hasPendingPayout && (
            <p className="muted" style={{ marginBottom: 0, marginTop: 8, fontSize: 12.5 }}>
              You need at least {formatMicros(data.account.minPayoutMicros)} available to withdraw.
            </p>
          )}
          {notice && <p className="muted" style={{ marginTop: 10 }}>{notice}</p>}

          {payouts.length > 0 && (
            <table className="table" style={{ marginTop: 14 }}>
              <thead><tr><th>Requested</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.requestedAt).toLocaleDateString()}</td>
                    <td>{formatMicros(p.amountMicros)}</td>
                    <td className="muted">{p.method}</td>
                    <td><span className={`pill pill-${p.status.toLowerCase()}`}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>Your videos</h3>
          {data.topVideos.length === 0 ? (
            <p className="muted">Nothing uploaded yet. <Link href="/upload">Upload something</Link>.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Video</th><th>Views</th><th>Counted</th><th>Earned</th><th>Embed</th></tr>
              </thead>
              <tbody>
                {data.topVideos.map((v) => (
                  <tr key={v.id}>
                    <td><Link href={`/watch/${v.slug}`}>{v.title}</Link></td>
                    <td>{v.views}</td>
                    <td>{v.countableViews}</td>
                    <td>{formatMicrosPrecise(v.earnedMicros)}</td>
                    <td>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => navigator.clipboard.writeText(
                          `<iframe src="${origin}/embed/${v.slug}" width="720" height="405" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`
                        ).catch(() => undefined)}
                      >
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="two-col" style={{ marginTop: 18 }}>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Last 30 days</h3>
            {data.daily.length === 0 ? <p className="muted">No views yet.</p> : (
              <table className="table">
                <thead><tr><th>Day</th><th>Views</th><th>Counted</th><th>Earned</th></tr></thead>
                <tbody>
                  {data.daily.slice(0, 14).map((d) => (
                    <tr key={d.day}>
                      <td>{new Date(d.day).toLocaleDateString()}</td>
                      <td>{d.views}</td>
                      <td>{d.countableViews}</td>
                      <td>{formatMicrosPrecise(d.earnedMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>By country</h3>
            <p className="muted" style={{ marginTop: -6, fontSize: 12.5 }}>
              Where your views come from decides what they pay.
            </p>
            {data.byCountry.length === 0 ? <p className="muted">No views yet.</p> : (
              <table className="table">
                <thead><tr><th>Country</th><th>Counted views</th><th>Earned</th></tr></thead>
                <tbody>
                  {data.byCountry.map((c) => (
                    <tr key={c.country}>
                      <td>{c.country === "XX" ? "Unknown" : c.country}</td>
                      <td>{c.countableViews}</td>
                      <td>{formatMicrosPrecise(c.earnedMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>Refer other uploaders</h3>
          <p className="muted">
            Your code: <code>{data.account.referralCode}</code> · share{" "}
            <code>{origin}/register?ref={data.account.referralCode}</code>
          </p>
        </div>
      </main>
    </>
  );
}
