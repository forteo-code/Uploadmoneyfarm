"use client";

import { useEffect, useState } from "react";
import { openPlayback, type PlaybackResponse } from "@/lib/api";
import { Player } from "./Player";
import styles from "./Player.module.css";

/**
 * Opens one playback session and renders the player. Used by the embed route,
 * where the player is the entire page. The watch page uses WatchExperience
 * instead, which shares a single session with the surrounding ad slots - two
 * sessions per view would double-count sessions and burn the ad frequency caps
 * twice over.
 */
export function PlayerLoader({ slug, embed = false }: { slug: string; embed?: boolean }) {
  const [data, setData] = useState<PlaybackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const embedDomain = embed && document.referrer ? new URL(document.referrer).hostname : undefined;
    openPlayback(slug, embedDomain)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "unavailable"));
    return () => { cancelled = true; };
  }, [slug, embed]);

  if (error) return <div className={styles.wrap}><div className={styles.center}>{error}</div></div>;
  if (!data) return <div className={styles.wrap}><div className={styles.center}>Loading…</div></div>;
  return <Player data={data} embed={embed} />;
}
