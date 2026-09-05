"use client";

import { useEffect, useState } from "react";
import { openPlayback, type PlaybackResponse } from "@/lib/api";
import { Player } from "./Player";
import { AdSlot } from "./AdSlot";
import styles from "./Player.module.css";

type VideoMeta = {
  title: string;
  description: string | null;
  views: string;
  createdAt: string;
  owner?: { displayName: string | null } | null;
};

/**
 * The watch page's client half.
 *
 * Opens exactly one playback session and shares it with every ad slot on the
 * page. The session is what the server counts views and ad frequency against,
 * so opening a second one per page view would inflate both.
 */
export function WatchExperience({ slug, video }: { slug: string; video: VideoMeta }) {
  const [data, setData] = useState<PlaybackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openPlayback(slug)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "unavailable"));
    return () => { cancelled = true; };
  }, [slug]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedCode = `<iframe src="${origin}/embed/${slug}" width="720" height="405" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;

  return (
    <div className="layout">
      <div>
        {error ? (
          <div className={styles.wrap}><div className={styles.center}>{error}</div></div>
        ) : data ? (
          <Player data={data} />
        ) : (
          <div className={styles.wrap}><div className={styles.center}>Loading…</div></div>
        )}

        <h1>{video.title}</h1>
        <p className="muted">
          {video.views} views · {new Date(video.createdAt).toLocaleDateString()}
          {video.owner?.displayName ? ` · ${video.owner.displayName}` : ""}
        </p>
        {video.description && <p style={{ marginTop: 12, lineHeight: 1.55 }}>{video.description}</p>}

        <div className="panel" style={{ marginTop: 16 }}>
          <p className="muted" style={{ marginTop: 0 }}>Embed this video</p>
          <textarea className="embed-code" rows={3} readOnly value={embedCode} onFocus={(e) => e.currentTarget.select()} />
          <button
            className="btn"
            style={{ marginTop: 8 }}
            onClick={() => {
              navigator.clipboard.writeText(embedCode).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }).catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy embed code"}
          </button>
        </div>
      </div>

      <aside>
        {data && (
          <div className="panel ad-rail">
            <AdSlot placements={data.ads.BANNER} token={data.session.token} slotType="BANNER" />
          </div>
        )}
      </aside>
    </div>
  );
}
