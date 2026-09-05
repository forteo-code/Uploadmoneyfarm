"use client";

import { useEffect, useRef, useState } from "react";
import type { AdPlacement } from "@/lib/api";
import { AdSlot, injectMarkup, reportImpression } from "./AdSlot";

/**
 * Ad density is driven entirely by operator config (see AdLayout on the API).
 * Nothing here decides how aggressive the page should be; it renders what the
 * server asks for.
 */

/**
 * A wall of banner units.
 *
 * Each unit draws from the same server-resolved waterfall, cycling through the
 * available networks so consecutive units are not all the same tag - most
 * networks cap how many identical zones they will fill on one page, so cycling
 * measurably improves total fill against repeating one zone N times.
 */
export function BannerWall({
  placements,
  token,
  count,
  columns = 2,
}: {
  placements: AdPlacement[] | undefined;
  token: string;
  count: number;
  columns?: number;
}) {
  if (!placements || placements.length === 0 || count <= 0) return null;

  return (
    <div
      className="banner-wall"
      style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 10 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <AdSlot
          key={i}
          // Rotating the start offset gives each unit a different first choice.
          placements={[...placements.slice(i % placements.length), ...placements.slice(0, i % placements.length)]}
          token={token}
          slotType="BANNER"
          className="banner-unit"
        />
      ))}
    </div>
  );
}

/** Fixed bar pinned to the bottom of the viewport, dismissible. */
export function StickyFooterAd({
  placements,
  token,
}: {
  placements: AdPlacement[] | undefined;
  token: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (!placements || placements.length === 0 || dismissed) return null;

  return (
    <div className="sticky-ad">
      <button className="sticky-ad-close" onClick={() => setDismissed(true)} aria-label="Close ad">
        ×
      </button>
      <AdSlot placements={placements} token={token} slotType="BANNER" />
    </div>
  );
}

/**
 * Click-to-open: the next click anywhere on the page opens the advertiser in a
 * new tab.
 *
 * Deliberately armed only AFTER playback has started, and never on the click
 * that starts it. The play click already fires the pop-under, and a browser
 * will silently block a second window opened from the same gesture - firing
 * both would lose the pop-under, which is the better-paying unit. Waiting one
 * click keeps both.
 *
 * Frequency is capped server-side when the plan is built; this additionally
 * remembers locally so a viewer navigating between videos is not hit repeatedly
 * within the same hour.
 */
export function ClickAd({
  placements,
  token,
  armed,
  capPerHour = 1,
}: {
  placements: AdPlacement[] | undefined;
  token: string;
  armed: boolean;
  capPerHour?: number;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (!armed || !placements || placements.length === 0) return;

    const storageKey = "dr_click_ad";
    const hourMs = 3600_000;

    const recentCount = (): number => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return 0;
        const times = (JSON.parse(raw) as number[]).filter((t) => Date.now() - t < hourMs);
        return times.length;
      } catch {
        return 0;
      }
    };

    const record = () => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const times = raw ? (JSON.parse(raw) as number[]) : [];
        times.push(Date.now());
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(times.filter((t) => Date.now() - t < hourMs)),
        );
      } catch {
        /* private browsing: the server-side cap still applies */
      }
    };

    if (recentCount() >= capPerHour) return;

    const onClick = (e: MouseEvent) => {
      if (fired.current) return;
      const target = e.target as HTMLElement | null;
      // Never hijack a deliberate exit: the viewer's own link or a close
      // control should do what it says.
      if (target?.closest("a, button, input, textarea, select, [data-no-click-ad]")) return;

      fired.current = true;
      record();
      const placement = placements[0]!;

      const host = document.createElement("div");
      host.style.display = "none";
      document.body.appendChild(host);
      injectMarkup(host, placement.payload);
      reportImpression(token, placement.networkId, "INTERSTITIAL", true);

      document.removeEventListener("click", onClick, true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [armed, placements, token, capPerHour]);

  return null;
}
