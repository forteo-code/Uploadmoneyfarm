"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch, formatMicros } from "@/lib/auth";

type Payout = {
  id: string; amountMicros: string; method: string; address: string; status: string; requestedAt: string;
  user: { id: string; email: string; fraudScore: number; strikeCount: number; accountAgeDays: number; videoCount: number; balanceFrozen: boolean };
  signals: { totalViews: number; countableViews: number; countableRatio: number | null };
};

export default function AdminPayouts() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [filter, setFilter] = useState("REQUESTED");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    authFetch(`/api/admin/payouts?status=${filter}`)
      .then((r) => (r.ok ? r.json() : { payouts: [] }))
      .then((b) => setPayouts(b.payouts ?? []))
      .catch(() => undefined);
  }, [filter]);
  useEffect(() => load(), [load]);

  async function decide(id: string, decision: string, notes?: string) {
    setBusy(id);
    await authFetch(`/api/admin/payouts/${id}/decide`, {
      method: "POST", body: JSON.stringify({ decision, notes }),
    });
    setBusy(null);
    load();
  }

  return (
    <>
      <div className="tabs-sub">
        {["REQUESTED", "APPROVED", "PAID", "REJECTED", "ALL"].map((f) => (
          <button key={f} className={`chip${filter === f ? " chip-active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {payouts.length === 0 ? <p className="muted">Nothing in this queue.</p> : payouts.map((p) => {
        // A low countable ratio is the clearest farming signal available here.
        const risky = (p.signals.countableRatio !== null && p.signals.countableRatio < 0.5)
          || p.user.fraudScore > 50 || p.user.strikeCount > 0 || p.user.accountAgeDays < 7;
        return (
          <div className={`panel${risky ? " panel-alert" : ""}`} key={p.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <strong style={{ fontSize: 20 }}>{formatMicros(p.amountMicros)}</strong>
                <p className="muted" style={{ margin: "3px 0" }}>{p.user.email} · {p.method}</p>
                <code style={{ fontSize: 11.5 }}>{p.address}</code>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={`pill pill-${p.status.toLowerCase()}`}>{p.status}</span>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{new Date(p.requestedAt).toLocaleString()}</p>
              </div>
            </div>

            <div className="signal-row">
              <span className={p.signals.countableRatio !== null && p.signals.countableRatio < 0.5 ? "signal signal-bad" : "signal"}>
                countable {p.signals.countableRatio !== null ? `${Math.round(p.signals.countableRatio * 100)}%` : "n/a"}
              </span>
              <span className="signal">{p.signals.totalViews} views</span>
              <span className={p.user.accountAgeDays < 7 ? "signal signal-bad" : "signal"}>{p.user.accountAgeDays}d old</span>
              <span className={p.user.fraudScore > 50 ? "signal signal-bad" : "signal"}>fraud {p.user.fraudScore}</span>
              <span className={p.user.strikeCount > 0 ? "signal signal-bad" : "signal"}>{p.user.strikeCount} strikes</span>
              <span className="signal">{p.user.videoCount} videos</span>
              {p.user.balanceFrozen && <span className="signal signal-bad">frozen</span>}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              {p.status === "REQUESTED" && (
                <>
                  <button className="btn" disabled={busy === p.id} onClick={() => decide(p.id, "APPROVE")}>Approve</button>
                  <button className="btn-ghost" disabled={busy === p.id}
                          onClick={() => decide(p.id, "REJECT", "Rejected on review")}>Reject and refund</button>
                </>
              )}
              {["APPROVED", "PROCESSING"].includes(p.status) && (
                <>
                  <button className="btn" disabled={busy === p.id} onClick={() => decide(p.id, "MARK_PAID")}>Mark as sent</button>
                  <button className="btn-ghost" disabled={busy === p.id}
                          onClick={() => decide(p.id, "MARK_FAILED", "Transfer failed")}>Mark failed and refund</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
