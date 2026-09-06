/**
 * Where the API lives — and it is two different places.
 *
 * NEXT_PUBLIC_API_URL is baked into the client bundle at build time and has to
 * be an address a *browser* can reach: the public origin.
 *
 * Server components run inside the web container, where that public origin
 * usually is not reachable at all — behind a reverse proxy it resolves to the
 * container itself, and the render fails with ECONNREFUSED on a port it is
 * listening on for something else. Server-side rendering needs the address on
 * the internal network instead (http://api:4000 under compose).
 *
 * API_INTERNAL_URL is read at run time, not build time, so the same image runs
 * in any topology. Unset, it falls back to the public URL, which is correct
 * when both are the same host.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

const isServer = typeof window === "undefined";

/** The base every fetch in this module goes through. */
export const apiBase = (): string =>
  (isServer ? process.env.API_INTERNAL_URL : undefined) ?? API_URL;

export type AdPlacement = {
  networkKey: string;
  networkId: string;
  name: string;
  kind: "script" | "vast";
  payload: string;
  estCpmMicros: string;
};

export type PlaybackResponse = {
  session: { token: string; expiresIn: number };
  video: {
    id: string;
    slug: string;
    title: string;
    durationSec: number | null;
    contentRating: "SFW" | "ADULT";
    poster: string | null;
    thumbnails: string | null;
  };
  playback: { manifest: string; maxHeight: number; availableHeights: number[] };
  ads: Partial<Record<"PREROLL" | "POPUNDER" | "OVERLAY" | "BANNER" | "INTERSTITIAL", AdPlacement[]>>;
  adLayout: { bannerCount: number; stickyFooter: boolean; clickAd: boolean; overlay: boolean };
  policy: { ageGate: boolean };
};

export async function openPlayback(slug: string, embedDomain?: string): Promise<PlaybackResponse> {
  const res = await fetch(`${apiBase()}/api/playback/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embedDomain }),
  });
  if (!res.ok) throw new Error(`playback ${res.status}`);
  return res.json();
}

export async function fetchVideo(slug: string) {
  const res = await fetch(`${apiBase()}/api/videos/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
