"use client";

import { useEffect, useRef } from "react";
import type { AdPlacement } from "@/lib/api";
import { API_URL } from "@/lib/api";

/**
 * Injects a network's raw ad tag.
 *
 * innerHTML does not execute <script> elements, and every one of these tags is
 * a script, so each one is recreated as a real element. This deliberately runs
 * operator-configured third-party code: that is what an ad tag is. The tags are
 * editable only from the admin console, never by uploaders or viewers, which is
 * the boundary that makes it acceptable.
 */
function injectMarkup(container: HTMLElement, markup: string): void {
  container.innerHTML = "";
  const template = document.createElement("template");
  template.innerHTML = markup;

  const activate = (node: Node): Node => {
    if (node.nodeName === "SCRIPT") {
      const original = node as HTMLScriptElement;
      const script = document.createElement("script");
      for (const attr of Array.from(original.attributes)) {
        script.setAttribute(attr.name, attr.value);
      }
      script.text = original.text;
      return script;
    }
    const clone = node.cloneNode(false);
    node.childNodes.forEach((child) => clone.appendChild(activate(child)));
    return clone;
  };

  template.content.childNodes.forEach((node) => container.appendChild(activate(node)));
}

export function reportImpression(
  token: string,
  networkId: string,
  slotType: string,
  filled: boolean,
): void {
  // keepalive so the report survives the pop-under stealing focus or the page
  // unloading mid-navigation - otherwise the impression is served but never
  // recorded, and the revenue report under-counts.
  fetch(`${API_URL}/api/track/impression`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, networkId, slotType, filled }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Script-based slot with waterfall fallthrough.
 *
 * There is no reliable way to detect a no-fill from a third-party script tag,
 * so the fallthrough here is time-based: if the container is still empty after
 * a grace period, treat it as a no-fill and try the next network. The last
 * entry is the house ad, which always renders - a slot must never be left as a
 * visible hole.
 */
export function AdSlot({
  placements,
  token,
  slotType,
  className,
  style,
}: {
  placements: AdPlacement[] | undefined;
  token: string;
  slotType: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = useRef(0);

  useEffect(() => {
    if (!ref.current || !placements || placements.length === 0) return;
    const container = ref.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tryNext = () => {
      if (cancelled || index.current >= placements.length) return;
      const placement = placements[index.current]!;
      injectMarkup(container, placement.payload);
      reportImpression(token, placement.networkId, slotType, true);

      timer = setTimeout(() => {
        if (cancelled) return;
        const filled = container.getBoundingClientRect().height > 4 || container.childElementCount > 1;
        if (!filled && index.current < placements.length - 1) {
          reportImpression(token, placement.networkId, slotType, false);
          index.current += 1;
          tryNext();
        }
      }, 2500);
    };

    tryNext();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      container.innerHTML = "";
    };
  }, [placements, token, slotType]);

  if (!placements || placements.length === 0) return null;
  return <div ref={ref} className={className} style={style} data-ad-slot={slotType} />;
}

/**
 * Pop-unders must be opened from inside a user gesture or the browser blocks
 * them, so this is called synchronously from the play click. Frequency capping
 * is enforced server-side when the plan is built - the client never decides how
 * often it may fire.
 */
export function firePopunder(placements: AdPlacement[] | undefined, token: string): void {
  if (!placements || placements.length === 0) return;
  const placement = placements[0]!;
  const host = document.createElement("div");
  host.style.display = "none";
  document.body.appendChild(host);
  injectMarkup(host, placement.payload);
  reportImpression(token, placement.networkId, "POPUNDER", true);
}
