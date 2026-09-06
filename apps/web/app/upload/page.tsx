"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { authFetch, getToken } from "@/lib/auth";
import { API_URL } from "@/lib/api";

type Stage = "idle" | "starting" | "uploading" | "processing" | "ready" | "error";

/** Parts upload in parallel; three is enough to saturate most connections. */
const PART_CONCURRENCY = 3;

export default function UploadPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; title: string } | null>(null);
  const [contentRating, setContentRating] = useState<"SFW" | "ADULT">("SFW");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    authFetch("/api/auth/me")
      .then((res) => setAuthed(res.ok))
      .catch(() => setAuthed(false));
  }, []);

  const upload = useCallback(async () => {
    if (!file) return;
    setError(null);
    setStage("starting");
    setProgress(0);

    try {
      // 1. Reserve the video row and open a multipart upload.
      const createRes = await authFetch("/api/uploads/create", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          sizeBytes: file.size,
          mimeType: file.type || "application/octet-stream",
          contentRating,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error ?? "could not start upload");

      const { videoId, uploadId, partSize, partCount, slug } = created;
      setStage("uploading");

      // 2. Bytes go browser -> bucket directly. The API only signs URLs, so
      //    upload volume never touches the app servers.
      const parts: Array<{ partNumber: number; etag: string }> = [];
      let uploadedBytes = 0;
      const token = getToken();

      const uploadPart = async (partNumber: number) => {
        const urlRes = await fetch(
          `${API_URL}/api/uploads/${videoId}/part/${partNumber}?uploadId=${encodeURIComponent(uploadId)}`,
          { headers: token ? { authorization: `Bearer ${token}` } : {}, credentials: "include" },
        );
        const { url } = await urlRes.json();
        if (!urlRes.ok || !url) throw new Error(`could not sign part ${partNumber}`);

        const start = (partNumber - 1) * partSize;
        const chunk = file.slice(start, Math.min(start + partSize, file.size));
        const put = await fetch(url, { method: "PUT", body: chunk });
        if (!put.ok) throw new Error(`part ${partNumber} failed to upload`);

        const etag = put.headers.get("etag");
        if (!etag) throw new Error(`part ${partNumber} returned no ETag`);

        parts.push({ partNumber, etag });
        uploadedBytes += chunk.size;
        setProgress(Math.round((uploadedBytes / file.size) * 100));
      };

      const queue = Array.from({ length: partCount }, (_, i) => i + 1);
      const workers = Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (next === undefined) return;
          await uploadPart(next);
        }
      });
      await Promise.all(workers);

      // 3. Finalise, which queues the encode.
      const completeRes = await authFetch(`/api/uploads/${videoId}/complete`, {
        method: "POST",
        body: JSON.stringify({ uploadId, parts }),
      });
      const completed = await completeRes.json();
      if (!completeRes.ok) throw new Error(completed.error ?? "could not finalise upload");

      // 4. Encoding happens on a worker; poll until it is playable.
      setStage("processing");
      const deadline = Date.now() + 30 * 60 * 1000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("processing is taking longer than expected");
        await new Promise((r) => setTimeout(r, 2500));
        const res = await authFetch("/api/videos/mine?limit=20");
        if (!res.ok) continue;
        const body = await res.json();
        const mine = body.videos?.find((v: { id: string }) => v.id === videoId);
        if (!mine) continue;
        if (mine.status === "READY") {
          setResult({ slug, title: mine.title });
          setStage("ready");
          return;
        }
        if (mine.status === "FAILED") throw new Error(mine.transcodeError ?? "encoding failed");
        if (mine.status === "BLOCKED") throw new Error("This upload was blocked by automated screening.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
      setStage("error");
    }
  }, [file, contentRating]);

  if (authed === false) {
    return (
      <>
        <Nav />
        <main className="container narrow">
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Sign in to upload</h1>
            <p className="muted">You need an account so we know who to pay.</p>
            <button className="btn btn-lg" onClick={() => router.push("/login")}>Sign in</button>
          </div>
        </main>
      </>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <Nav />
      <main className="container narrow">
        {stage === "ready" && result ? (
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Ready</h1>
            <p className="muted">Your video is live. Share the link or embed it anywhere.</p>
            <label className="field">
              <span>Direct link</span>
              <input readOnly value={`${origin}/watch/${result.slug}`} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <label className="field">
              <span>Embed code</span>
              <textarea className="embed-code" rows={3} readOnly
                        value={`<iframe src="${origin}/embed/${result.slug}" width="720" height="405" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`}
                        onFocus={(e) => e.currentTarget.select()} />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <Link href={`/watch/${result.slug}`}><button className="btn">Watch it</button></Link>
              <button className="btn-ghost" onClick={() => { setFile(null); setResult(null); setStage("idle"); setProgress(0); }}>
                Upload another
              </button>
            </div>
          </div>
        ) : (
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Upload</h1>

            <div
              className={`dropzone${dragging ? " dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept="video/*,.mkv,.avi,.flv,.ts,.m2ts,.vob,.divx"
                     style={{ display: "none" }}
                     onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span className="muted">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                </>
              ) : (
                <>
                  <strong>Drop a video here</strong>
                  <span className="muted">or click to choose · any format, up to 5 GB</span>
                </>
              )}
            </div>

            <label className="field" style={{ marginTop: 16 }}>
              <span>Content rating</span>
              <select value={contentRating} onChange={(e) => setContentRating(e.target.value as "SFW" | "ADULT")}>
                <option value="SFW">Standard</option>
                <option value="ADULT">Adult — 18+ (age gate shown)</option>
              </select>
            </label>

            {stage === "uploading" || stage === "processing" ? (
              <div style={{ marginTop: 18 }}>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${stage === "processing" ? 100 : progress}%` }} />
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  {stage === "uploading"
                    ? `Uploading… ${progress}%`
                    : "Encoding. This takes a few minutes for long videos - you can leave this page open."}
                </p>
              </div>
            ) : null}

            {error && <p className="error">{error}</p>}

            <button
              className="btn btn-lg"
              style={{ marginTop: 16 }}
              disabled={!file || stage === "uploading" || stage === "processing" || stage === "starting"}
              onClick={() => void upload()}
            >
              {stage === "starting" ? "Starting…" : stage === "uploading" ? "Uploading…"
                : stage === "processing" ? "Encoding…" : "Upload"}
            </button>

            <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12.5 }}>
              Uploads are unlisted by default - reachable only by the link you share.
              Every upload is screened automatically before it goes live.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
