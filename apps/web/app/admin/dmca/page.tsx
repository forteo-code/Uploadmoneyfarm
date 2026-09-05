"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

type Notice = {
  id: string;
  claimant: { name: string; email: string; org: string | null };
  workDescription: string;
  status: string;
  receivedAt: string;
  hoursRemaining: number;
  overdue: boolean;
  targets: Array<{ id: string; url: string; resolved: boolean; video: { slug: string; title: string; status: string } | null }>;
};

export default function AdminDmca() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("RECEIVED");

  const load = useCallback(() => {
    authFetch(`/api/admin/dmca?status=${filter}`)
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((b) => setNotices(b.notices ?? []))
      .catch(() => undefined);
  }, [filter]);
  useEffect(() => load(), [load]);

  async function act(id: string, path: string, body?: unknown) {
    setBusy(id);
    await authFetch(`/api/admin/dmca/${id}/${path}`, { method: "POST", body: JSON.stringify(body ?? {}) });
    setBusy(null);
    load();
  }

  return (
    <>
      <div className="tabs-sub">
        {["RECEIVED", "ACTIONED", "REJECTED", "COUNTER_NOTICED", "ALL"].map((f) => (
          <button key={f} className={`chip${filter === f ? " chip-active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {notices.length === 0 ? <p className="muted">Nothing in this queue.</p> : notices.map((n) => (
        <div className={`panel${n.overdue ? " panel-alert" : ""}`} key={n.id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <strong>{n.claimant.name}</strong>{n.claimant.org ? ` · ${n.claimant.org}` : ""}
              <p className="muted" style={{ margin: "3px 0" }}>{n.claimant.email}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={`pill ${n.overdue ? "pill-rejected" : "pill-requested"}`}>
                {n.overdue ? `${Math.abs(n.hoursRemaining)}h overdue` : `${n.hoursRemaining}h left`}
              </span>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{new Date(n.receivedAt).toLocaleString()}</p>
            </div>
          </div>

          <p style={{ fontSize: 13.5, margin: "10px 0" }}>{n.workDescription}</p>

          <table className="table">
            <thead><tr><th>Target</th><th>Matched</th><th>State</th></tr></thead>
            <tbody>
              {n.targets.map((t) => (
                <tr key={t.id}>
                  <td style={{ wordBreak: "break-all", fontSize: 12.5 }}>{t.url}</td>
                  <td>{t.video ? t.video.title : <span className="muted">no match</span>}</td>
                  <td>{t.video ? <span className="pill">{t.video.status}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {n.status === "RECEIVED" && (
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button className="btn" disabled={busy === n.id} onClick={() => act(n.id, "action")}>
                Remove content and strike
              </button>
              <button className="btn-ghost" disabled={busy === n.id}
                      onClick={() => act(n.id, "reject", { reason: "Incomplete or invalid notice" })}>
                Reject notice
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
