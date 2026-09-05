"use client";

import { useEffect, useState } from "react";
import { authFetch, formatMicrosPrecise } from "@/lib/auth";

type Row = {
  networkKey: string; name: string; slotType: string; country: string;
  impressions: string; filled: string; fillRate: number; estRevenueMicros: string;
};

/**
 * The report the waterfall exists for: which network actually pays, per geo.
 * Underperformers get reordered or disabled from the policy tab - a config
 * change, never a deploy.
 */
export default function AdminNetworks() {
  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState(7);

  useEffect(() => {
    authFetch(`/api/admin/networks?days=${days}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((b) => setRows(b.rows ?? []))
      .catch(() => undefined);
  }, [days]);

  return (
    <>
      <div className="tabs-sub">
        {[1, 7, 30].map((d) => (
          <button key={d} className={`chip${days === d ? " chip-active" : ""}`} onClick={() => setDays(d)}>
            {d}d
          </button>
        ))}
      </div>

      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Revenue is estimated from configured CPMs until the network reports actuals.
          Use it to rank networks against each other, not as an invoice.
        </p>
        {rows.length === 0 ? <p className="muted">No impressions recorded yet.</p> : (
          <table className="table">
            <thead>
              <tr><th>Network</th><th>Slot</th><th>Country</th><th>Impressions</th><th>Fill</th><th>Est. revenue</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.networkKey}-${r.country}-${i}`}>
                  <td>{r.name}</td>
                  <td className="muted">{r.slotType}</td>
                  <td>{r.country === "XX" ? "Unknown" : r.country}</td>
                  <td>{r.impressions}</td>
                  <td className={r.fillRate < 0.5 ? "signal-bad" : ""}>{Math.round(r.fillRate * 100)}%</td>
                  <td>{formatMicrosPrecise(r.estRevenueMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
