"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

type Entry = { key: string; value: unknown; updatedAt: string };

const GROUPS: Array<{ title: string; prefix: string; note: string }> = [
  { title: "Content policy", prefix: "content.", note: "What the site accepts. Hash screening and takedown handling are not configurable - they are legal obligations, not preferences." },
  { title: "Ad density", prefix: "ads.", note: "The revenue/usability dial. More units raise gross impressions but depress fill rate and per-unit CPM. Move one at a time and watch revenue per thousand views." },
  { title: "Payouts", prefix: "payout.", note: "The hold period is what makes clawback possible; shortening it shortens the window to catch fraud before money leaves." },
  { title: "Delivery quality", prefix: "quality.", note: "1080p roughly doubles bandwidth per view against 720p. Per-country ceilings live in the country table." },
  { title: "Site", prefix: "site.", note: "Public browsing is off by default: an index turns a neutral host into a content platform." },
  { title: "Storage", prefix: "storage.", note: "Unwatched videos accrue cost forever unless something sweeps them." },
];

export default function AdminConfig() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    authFetch("/api/admin/config")
      .then((r) => (r.ok ? r.json() : { config: [] }))
      .then((b) => setEntries(b.config ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function save(key: string) {
    const raw = drafts[key];
    if (raw === undefined) return;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { value = raw; }
    await authFetch(`/api/admin/config/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) });
    setSaved(key);
    setTimeout(() => setSaved(null), 1600);
    load();
  }

  return (
    <>
      {GROUPS.map((g) => {
        const rows = entries.filter((e) => e.key.startsWith(g.prefix));
        if (rows.length === 0) return null;
        return (
          <div className="panel" key={g.prefix} style={{ marginBottom: 14 }}>
            <h3 style={{ marginTop: 0 }}>{g.title}</h3>
            <p className="muted" style={{ marginTop: -4, fontSize: 12.5 }}>{g.note}</p>
            <table className="table">
              <tbody>
                {rows.map((e) => (
                  <tr key={e.key}>
                    <td style={{ width: "40%" }}><code>{e.key}</code></td>
                    <td>
                      <input
                        className="config-input"
                        value={drafts[e.key] ?? JSON.stringify(e.value)}
                        onChange={(ev) => setDrafts((d) => ({ ...d, [e.key]: ev.target.value }))}
                      />
                    </td>
                    <td style={{ width: 90 }}>
                      <button className="btn-ghost btn-sm" onClick={() => save(e.key)}>
                        {saved === e.key ? "Saved" : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
