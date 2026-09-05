export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

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
  policy: { ageGate: boolean };
};

export async function openPlayback(slug: string, embedDomain?: string): Promise<PlaybackResponse> {
  const res = await fetch(`${API_URL}/api/playback/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embedDomain }),
  });
  if (!res.ok) throw new Error(`playback ${res.status}`);
  return res.json();
}

export async function fetchVideo(slug: string) {
  const res = await fetch(`${API_URL}/api/videos/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
