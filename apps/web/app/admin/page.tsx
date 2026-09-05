"use client";

import { useEffect, useState } from "react";
import { authFetch, formatMicros } from "@/lib/auth";

type Overview = {
  users: number; videos: number; quarantined: number; openReports: number; pendingPayouts: number;
  dmca: { open: number; overdue: number; slaHours: number };
  last24h: { views: string; countableViews: string; adImpressions: string; grossMicros: string; uploaderMicros: string; marginMicros: string };
};

export default function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    authFetch("/api/admin/overview").then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => undefined);
  }, []);
  if (!data) return <p className="muted">Loading…</p>;

  const counted = Number(data.last24h.countableViews);
  const gross = BigInt(data.last24h.grossMicros);
  // Revenue per thousand counted views - the number every other decision keys off.
  const rpm = counted > 0 ? (Number(gross) / 1_000_000 / counted) * 1000 : 0;

  return (
    <>
      {data.dmca.overdue > 0 && (
        <div className="alert">
          {data.dmca.overdue} takedown notice{data.dmca.overdue === 1 ? " is" : "s are"} past the{" "}
          {data.dmca.slaHours}-hour response window. Safe harbour depends on acting expeditiously.
        </div>
      )}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Views (24h)</span>
          <strong className="stat-value">{data.last24h.views}</strong>
          <span className="muted">{data.last24h.countableViews} counted</span>
        </div>
        <div className="stat">
          <span className="stat-label">Gross (24h)</span>
          <strong className="stat-value">{formatMicros(data.last24h.grossMicros)}</strong>
          <span className="muted">${rpm.toFixed(2)} RPM</span>
        </div>
        <div className="stat">
          <span className="stat-label">Kept after share</span>
          <strong className="stat-value">{formatMicros(data.last24h.marginMicros)}</strong>
          <span className="muted">{formatMicros(data.last24h.uploaderMicros)} to uploaders</span>
        </div>
        <div className="stat">
          <span className="stat-label">Ad impressions</span>
          <strong className="stat-value">{data.last24h.adImpressions}</strong>
          <span className="muted">last 24 hours</span>
        </div>
      </div>

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div className="stat"><span className="stat-label">Open takedowns</span><strong className="stat-value">{data.dmca.open}</strong><span className="muted">{data.dmca.overdue} overdue</span></div>
        <div className="stat"><span className="stat-label">Pending payouts</span><strong className="stat-value">{data.pendingPayouts}</strong><span className="muted">awaiting review</span></div>
        <div className="stat"><span className="stat-label">Quarantined</span><strong className="stat-value">{data.quarantined}</strong><span className="muted">blocked at ingest</span></div>
        <div className="stat"><span className="stat-label">Open reports</span><strong className="stat-value">{data.openReports}</strong><span className="muted">user-submitted</span></div>
      </div>

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div className="stat"><span className="stat-label">Accounts</span><strong className="stat-value">{data.users}</strong></div>
        <div className="stat"><span className="stat-label">Live videos</span><strong className="stat-value">{data.videos}</strong></div>
      </div>
    </>
  );
}
