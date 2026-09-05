"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch, formatMicros } from "@/lib/auth";

type User = {
  id: string; email: string; status: string; role: string; fraudScore: number; strikeCount: number;
  balanceFrozen: boolean; createdAt: string; videoCount: number;
  availableMicros: string; pendingMicros: string; lifetimeMicros: string;
};

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    authFetch(`/api/admin/users?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((b) => setUsers(b.users ?? []))
      .catch(() => undefined);
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function act(id: string, action: string, reason?: string) {
    setBusy(id);
    await authFetch(`/api/admin/users/${id}/action`, { method: "POST", body: JSON.stringify({ action, reason }) });
    setBusy(null);
    load();
  }

  return (
    <>
      <div className="panel">
        <input className="search" placeholder="Search by email, id or referral code"
               value={q} onChange={(e) => setQ(e.target.value)} />
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Account</th><th>State</th><th>Videos</th><th>Lifetime</th><th>Available</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.email}
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {u.role} · fraud {u.fraudScore} · {u.strikeCount} strikes
                  </div>
                </td>
                <td>
                  <span className={`pill pill-${u.status === "ACTIVE" ? "paid" : "rejected"}`}>{u.status}</span>
                  {u.balanceFrozen && <span className="pill pill-rejected" style={{ marginLeft: 4 }}>frozen</span>}
                </td>
                <td>{u.videoCount}</td>
                <td>{formatMicros(u.lifetimeMicros)}</td>
                <td>{formatMicros(u.availableMicros)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {u.status === "ACTIVE" ? (
                      <>
                        <button className="btn-ghost btn-sm" disabled={busy === u.id} onClick={() => act(u.id, "SUSPEND")}>Suspend</button>
                        <button className="btn-ghost btn-sm" disabled={busy === u.id}
                                onClick={() => act(u.id, "TERMINATE", "Terminated by admin")}>Terminate</button>
                      </>
                    ) : (
                      <button className="btn-ghost btn-sm" disabled={busy === u.id} onClick={() => act(u.id, "REINSTATE")}>Reinstate</button>
                    )}
                    <button className="btn-ghost btn-sm" disabled={busy === u.id}
                            onClick={() => act(u.id, u.balanceFrozen ? "UNFREEZE_BALANCE" : "FREEZE_BALANCE")}>
                      {u.balanceFrozen ? "Unfreeze" : "Freeze"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
