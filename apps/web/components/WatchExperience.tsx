"use client";

import { useEffect, useState } from "react";
import { openPlayback, type PlaybackResponse } from "@/lib/api";
import { Player } from "./Player";
import { AdSlot } from "./AdSlot";
import { BannerWall, StickyFooterAd, ClickAd } from "./AdUnits";
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
 * Opens exactly one playback session and shares it with every ad unit on the
 * page. The session is what views and ad frequency are counted against, so a
 * second one per page view would inflate both.
 */
export function WatchExperience({ slug, video }: { slug: string; video: VideoMeta }) {
  const [data, setData] = useState<PlaybackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openPlayback(slug)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "unavailable"));
    return () => { cancelled = true; };
  }, [slug]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedCode = `<iframe src="${origin}/embed/${slug}" width="720" height="405" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
  const layout = data?.adLayout;

  // Banners are split between the rail and below the player so a large count
  // does not become one unbroken column nobody scrolls past.
  const railBanners = layout ? Math.min(3, layout.bannerCount) : 0;
  const wallBanners = layout ? Math.max(0, layout.bannerCount - railBanners) : 0;

  return (
    <>
      <div className="layout">
        <div>
          {error ? (
            <div className={styles.wrap}><div className={styles.center}>{error}</div></div>
          ) : data ? (
            <Player data={data} onPlaybackStart={() => setPlaybackStarted(true)} />
          ) : (
            <div className={styles.wrap}><div className={styles.center}>Loading…</div></div>
          )}

          <h1>{video.title}</h1>
          <p className="muted">
            {video.views} views · {new Date(video.createdAt).toLocaleDateString()}
            {video.owner?.displayName ? ` · ${video.owner.displayName}` : ""}
          </p>
          {video.description && <p style={{ marginTop: 12, lineHeight: 1.55 }}>{video.description}</p>}

          <div className="panel" style={{ marginTop: 16 }} data-no-click-ad>
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

          {data && wallBanners > 0 && (
            <div style={{ marginTop: 18 }}>
              <BannerWall placements={data.ads.BANNER} token={data.session.token} count={wallBanners} columns={3} />
            </div>
          )}
        </div>

        <aside>
          {data && railBanners > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {Array.from({ length: railBanners }, (_, i) => (
                <div className="panel ad-rail" key={i}>
                  <AdSlot placements={data.ads.BANNER} token={data.session.token} slotType="BANNER" />
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {data && layout?.stickyFooter && (
        <StickyFooterAd placements={data.ads.BANNER} token={data.session.token} />
      )}
      {data && layout?.clickAd && (
        <ClickAd
          placements={data.ads.INTERSTITIAL}
          token={data.session.token}
          armed={playbackStarted}
        />
      )}
    </>
  );
}
