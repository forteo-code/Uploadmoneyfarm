import { Router } from "express";
import { env } from "../env.js";
import { asyncHandler } from "../middleware/error.js";
import { getConfig } from "../lib/config.js";

export const adsRouter = Router();

/**
 * Demo ad inventory.
 *
 * Real networks will not issue tags until they can see a live site with real
 * content on it, which is a chicken-and-egg problem when you are trying to
 * decide how aggressive the ad experience should be. These endpoints stand in
 * a complete, self-hosted ad stack - a real VAST pre-roll, a pop-under landing
 * page, overlay and banner creatives - so the operator can see and tune the
 * actual viewer experience before signing up to anything.
 *
 * Everything here is inert placeholder content, clearly labelled, and only
 * served when the ads.demoMode config flag is on.
 */

const DEMO_ADVERTISER = "Demo Advertiser";

async function requireDemoMode(): Promise<boolean> {
  return getConfig<boolean>("ads.demoMode", false);
}

/** 1x1 transparent GIF, the standard tracking-beacon response. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

adsRouter.get(
  "/demo/beacon",
  asyncHandler(async (req, res) => {
    // Beacons must never fail loudly - a broken pixel should not break a page.
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end(PIXEL);
  }),
);

/**
 * VAST 3.0 linear pre-roll. Deliberately a real, spec-shaped document rather
 * than a stub, so it exercises the same parsing path a live network response
 * would: wrapper-free inline ad, impression beacons, quartile tracking,
 * click-through, and a skip offset.
 */
adsRouter.get(
  "/demo/vast.xml",
  asyncHandler(async (req, res) => {
    if (!(await requireDemoMode())) {
      res.setHeader("Content-Type", "application/xml");
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>');
    }

    const api = env.API_PUBLIC_URL.replace(/\/$/, "");
    const media = `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "")}/demo/preroll.webm`;
    const beacon = (event: string) => `${api}/api/ads/demo/beacon?e=${event}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="demo-preroll">
    <InLine>
      <AdSystem>Dropreel Demo</AdSystem>
      <AdTitle>${DEMO_ADVERTISER}</AdTitle>
      <Impression><![CDATA[${beacon("impression")}]]></Impression>
      <Creatives>
        <Creative id="demo-linear-1">
          <Linear skipoffset="00:00:05">
            <Duration>00:00:15</Duration>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[${beacon("start")}]]></Tracking>
              <Tracking event="firstQuartile"><![CDATA[${beacon("firstQuartile")}]]></Tracking>
              <Tracking event="midpoint"><![CDATA[${beacon("midpoint")}]]></Tracking>
              <Tracking event="thirdQuartile"><![CDATA[${beacon("thirdQuartile")}]]></Tracking>
              <Tracking event="complete"><![CDATA[${beacon("complete")}]]></Tracking>
              <Tracking event="skip"><![CDATA[${beacon("skip")}]]></Tracking>
            </TrackingEvents>
            <VideoClicks>
              <ClickThrough><![CDATA[${api}/api/ads/demo/landing]]></ClickThrough>
              <ClickTracking><![CDATA[${beacon("click")}]]></ClickTracking>
            </VideoClicks>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/webm" width="1280" height="720" bitrate="800" scalable="true" maintainAspectRatio="true">
                <![CDATA[${media}]]>
              </MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(xml);
  }),
);

/** Where the demo pop-under and click-throughs land. */
adsRouter.get(
  "/demo/landing",
  asyncHandler(async (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${DEMO_ADVERTISER}</title>
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#12141a; color:#e6e8ec;
         display:grid; place-items:center; height:100vh; text-align:center; }
  .box { max-width:460px; padding:32px; border:1px solid #2a2e38; border-radius:10px; background:#181b22; }
  h1 { margin:0 0 10px; font-size:22px; }
  .tag { display:inline-block; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
         color:#04121f; background:#ffb84d; padding:3px 9px; border-radius:3px; margin-bottom:14px; }
  p { color:#9aa2b1; line-height:1.6; font-size:14px; margin:0; }
</style></head>
<body><div class="box">
  <span class="tag">Demo pop-under</span>
  <h1>${DEMO_ADVERTISER}</h1>
  <p>This is the window a pop-under network opens behind the video when a viewer
  clicks play. A real network serves its own advertiser here and pays you per
  thousand of these.</p>
</div></body></html>`);
  }),
);
