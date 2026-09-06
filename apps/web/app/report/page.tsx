"use client";

import { useState } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { API_URL } from "@/lib/api";

const CATEGORIES: Array<[string, string]> = [
  ["CSAM", "Child sexual abuse material"],
  ["NONCONSENSUAL", "Non-consensual or intimate imagery"],
  ["TERRORISM", "Terrorism or violent extremism"],
  ["ILLEGAL_OTHER", "Other illegal content"],
  ["MALWARE", "Malware or phishing"],
  ["SPAM", "Spam"],
];

export default function ReportPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const raw = String(form.get("videoId") ?? "").trim();
    // Accept a full URL or a bare id; the API resolves either.
    const videoId = raw.split("/").filter(Boolean).pop() ?? raw;

    const res = await fetch(`${API_URL}/api/dmca/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId,
        category: form.get("category"),
        details: form.get("details") || undefined,
        reporterEmail: form.get("reporterEmail") || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) setSent(true);
    else setError(res.status === 404 ? "We could not find that video. Check the link and try again." : "Could not submit the report.");
  }

  return (
    <>
      <Nav />
      <main className="container legal">
        <h1>Report content</h1>
        <p className="muted">
          Report illegal material. Reports of child sexual abuse material are escalated immediately.
          For copyright, use the <a href="/dmca">takedown form</a> instead.
        </p>

        {sent ? (
          <div className="panel"><h2 style={{ marginTop: 0 }}>Report received</h2>
            <p className="muted" style={{ marginBottom: 0 }}>Thank you. Our team reviews reports in priority order.</p>
          </div>
        ) : (
          <form className="panel" onSubmit={submit}>
            <label className="field"><span>Video link or ID *</span><input name="videoId" required /></label>
            <label className="field">
              <span>Category *</span>
              <select name="category" required defaultValue="">
                <option value="" disabled>Choose one</option>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="field"><span>Details</span><textarea name="details" rows={4} maxLength={5000} /></label>
            <label className="field"><span>Your email (optional)</span><input name="reporterEmail" type="email" /></label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-lg" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit report"}</button>
          </form>
        )}
      </main>
      <Footer />
    </>
  );
}
