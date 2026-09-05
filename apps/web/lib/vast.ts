/**
 * Minimal VAST 2/3 linear-ad client.
 *
 * Pre-roll is the highest-CPM slot in the stack, and every network that will
 * take this inventory serves it as VAST. A full IAB implementation is a large
 * dependency; what actually earns money is: follow wrappers, pick a playable
 * MediaFile, fire the Impression and quartile beacons, and honour ClickThrough.
 * Unfired beacons mean unpaid impressions, so the tracking half matters as much
 * as the playback half.
 */

export type VastAd = {
  mediaUrl: string;
  durationSec: number | null;
  impressions: string[];
  clickThrough: string | null;
  clickTracking: string[];
  tracking: Record<string, string[]>;
  skipOffsetSec: number | null;
};

const MAX_WRAPPER_DEPTH = 4;
const FETCH_TIMEOUT_MS = 6000;

function textOf(node: Element | null): string | null {
  const raw = node?.textContent?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** VAST durations are HH:MM:SS(.mmm). */
function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

function parseSkipOffset(value: string | null, durationSec: number | null): number | null {
  if (!value) return null;
  if (value.endsWith("%") && durationSec) {
    const pct = Number(value.slice(0, -1));
    return Number.isFinite(pct) ? (durationSec * pct) / 100 : null;
  }
  return parseDuration(value);
}

async function fetchXml(url: string): Promise<Document | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) return null;
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.querySelector("parsererror") ? null : doc;
  } catch {
    // A network error, a timeout or a network that has stopped answering are
    // all the same outcome here: no fill, move to the next network.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function collectTracking(linear: Element): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  linear.querySelectorAll("TrackingEvents > Tracking").forEach((node) => {
    const event = node.getAttribute("event");
    const url = textOf(node);
    if (!event || !url) return;
    (out[event] ??= []).push(url);
  });
  return out;
}

/**
 * Picks the most appropriate MediaFile: progressive MP4, and the highest
 * bitrate that still fits the cap. Overshooting the cap on an ad would spend
 * bandwidth we are deliberately rationing on the content itself.
 */
function selectMediaFile(linear: Element, maxHeight: number): string | null {
  const candidates = Array.from(linear.querySelectorAll("MediaFiles > MediaFile"))
    .map((node) => ({
      url: textOf(node),
      type: node.getAttribute("type") ?? "",
      height: Number(node.getAttribute("height") ?? 0),
      bitrate: Number(node.getAttribute("bitrate") ?? 0),
      delivery: node.getAttribute("delivery") ?? "progressive",
    }))
    .filter((m) => m.url && /mp4|webm/i.test(m.type) && m.delivery !== "streaming");

  if (candidates.length === 0) return null;

  const fitting = candidates.filter((m) => m.height === 0 || m.height <= maxHeight);
  const pool = fitting.length > 0 ? fitting : candidates;
  pool.sort((a, b) => b.bitrate - a.bitrate);
  return pool[0]?.url ?? null;
}

export async function loadVast(tagUrl: string, maxHeight: number, depth = 0): Promise<VastAd | null> {
  if (depth > MAX_WRAPPER_DEPTH) return null;

  const doc = await fetchXml(tagUrl);
  if (!doc) return null;

  // Wrappers redirect to another tag; carry the outer impression beacons
  // forward so they still fire against the resolved inline ad.
  const wrapperUri = textOf(doc.querySelector("Wrapper > VASTAdTagURI"));
  if (wrapperUri) {
    const inner = await loadVast(wrapperUri, maxHeight, depth + 1);
    if (!inner) return null;
    const outerImpressions = Array.from(doc.querySelectorAll("Wrapper > Impression"))
      .map((n) => textOf(n))
      .filter((u): u is string => Boolean(u));
    return { ...inner, impressions: [...outerImpressions, ...inner.impressions] };
  }

  const linear = doc.querySelector("InLine Creatives Creative Linear");
  if (!linear) return null;

  const mediaUrl = selectMediaFile(linear, maxHeight);
  if (!mediaUrl) return null;

  const durationSec = parseDuration(textOf(linear.querySelector("Duration")));

  return {
    mediaUrl,
    durationSec,
    impressions: Array.from(doc.querySelectorAll("InLine > Impression"))
      .map((n) => textOf(n))
      .filter((u): u is string => Boolean(u)),
    clickThrough: textOf(linear.querySelector("VideoClicks > ClickThrough")),
    clickTracking: Array.from(linear.querySelectorAll("VideoClicks > ClickTracking"))
      .map((n) => textOf(n))
      .filter((u): u is string => Boolean(u)),
    tracking: collectTracking(linear),
    skipOffsetSec: parseSkipOffset(linear.getAttribute("skipoffset"), durationSec),
  };
}

/**
 * Beacons are fire-and-forget images. Networks expect a GET and do not care
 * about the response, and a failed beacon must never interrupt playback.
 */
export function fireBeacons(urls: string[] | undefined): void {
  if (!urls) return;
  for (const url of urls) {
    try {
      const img = new Image();
      img.referrerPolicy = "no-referrer-when-downgrade";
      img.src = url;
    } catch {
      /* a dead beacon is not worth a broken player */
    }
  }
}
