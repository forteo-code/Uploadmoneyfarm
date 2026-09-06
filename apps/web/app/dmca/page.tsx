"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { API_URL } from "@/lib/api";

/**
 * Public takedown form.
 *
 * Deliberately unauthenticated and linked from every page. Safe harbour rests
 * on a claimant being able to reach the designated agent easily; a form behind
 * a login is a liability, not a filter.
 */
export default function DmcaPage() {
  const [agent, setAgent] = useState<{ name: string; email: string; address: string } | null>(null);
  const [sent, setSent] = useState<{ noticeId: string; dueAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/dmca/agent`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setAgent(b?.agent ?? null))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);

    const res = await fetch(`${API_URL}/api/dmca/notice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claimantName: form.get("claimantName"),
        claimantEmail: form.get("claimantEmail"),
        claimantOrg: form.get("claimantOrg") || undefined,
        claimantAddress: form.get("claimantAddress"),
        claimantPhone: form.get("claimantPhone") || undefined,
        targetUrls: String(form.get("targetUrls") ?? "").split(/\s+/).filter(Boolean),
        workDescription: form.get("workDescription"),
        goodFaithStatement: form.get("goodFaith") === "on",
        accuracyStatement: form.get("accuracy") === "on",
        signature: form.get("signature"),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setSent({ noticeId: body.noticeId, dueAt: body.dueAt });
    else setError(body.error === "validation_failed" ? "Please complete every required field, including both sworn statements." : "Could not submit the notice. Please email the agent below.");
  }

  return (
    <>
      <Nav />
      <main className="container legal">
        <h1>Copyright takedown</h1>
        <p className="muted">
          If material here infringes your copyright, send a notice using this form and we will
          action valid notices promptly.
        </p>

        {agent && (
          <div className="panel" style={{ marginBottom: 22 }}>
            <strong>Designated agent</strong>
            <p className="muted" style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>
              {agent.name}{"\n"}{agent.email}{"\n"}{agent.address}
            </p>
          </div>
        )}

        {sent ? (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Notice received</h2>
            <p>Reference <code>{sent.noticeId}</code>.</p>
            <p className="muted">
              We aim to action valid notices by {new Date(sent.dueAt).toLocaleString()}. Keep the
              reference for any follow-up.
            </p>
          </div>
        ) : (
          <form className="panel" onSubmit={submit}>
            <label className="field"><span>Your full name *</span><input name="claimantName" required maxLength={200} /></label>
            <label className="field"><span>Email *</span><input name="claimantEmail" type="email" required /></label>
            <label className="field"><span>Company or rights holder</span><input name="claimantOrg" maxLength={200} /></label>
            <label className="field"><span>Postal address *</span><input name="claimantAddress" required maxLength={600} /></label>
            <label className="field"><span>Phone</span><input name="claimantPhone" maxLength={60} /></label>
            <label className="field">
              <span>Infringing URLs *</span>
              <textarea name="targetUrls" required rows={4} placeholder="One URL per line" />
            </label>
            <label className="field">
              <span>Describe the work being infringed *</span>
              <textarea name="workDescription" required rows={3} minLength={10} />
            </label>

            <label className="checkline">
              <input type="checkbox" name="goodFaith" required />
              <span>I have a good faith belief that the use described is not authorised by the copyright owner, its agent, or the law.</span>
            </label>
            <label className="checkline">
              <input type="checkbox" name="accuracy" required />
              <span>The information in this notice is accurate, and under penalty of perjury I am the owner or authorised to act on the owner&rsquo;s behalf.</span>
            </label>

            <label className="field" style={{ marginTop: 12 }}>
              <span>Electronic signature *</span>
              <input name="signature" required maxLength={200} placeholder="Type your full name" />
            </label>

            {error && <p className="error">{error}</p>}
            <button className="btn btn-lg" type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit notice"}
            </button>
          </form>
        )}

        <h2>Counter-notice</h2>
        <p>
          If your material was removed and you believe that was a mistake or misidentification, you
          can file a counter-notice from your account. Reinstatement is not automatic: a statutory
          waiting period applies.
        </p>

        <h2>Repeat infringers</h2>
        <p>
          Accounts that accumulate repeated valid notices are terminated and their uploads removed.
        </p>
      </main>
      <Footer />
    </>
  );
}
