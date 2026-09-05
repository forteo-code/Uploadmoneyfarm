"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, type PlaybackResponse } from "@/lib/api";
import { loadVast, fireBeacons, type VastAd } from "@/lib/vast";
import { loadThumbnails, cueAt, type ThumbCue } from "@/lib/thumbnails";
import { AdSlot, firePopunder, reportImpression } from "./AdSlot";
import { HEARTBEAT_SECONDS } from "@/lib/constants";
import styles from "./Player.module.css";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

type Phase = "gate" | "idle" | "preroll" | "playing" | "error";

export function Player({ data, embed = false }: { data: PlaybackResponse; embed?: boolean }) {
  const [phase, setPhase] = useState<Phase>(data.policy.ageGate ? "gate" : "idle");
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void; currentLevel: number; levels: unknown[] } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(embed);
  const [volume, setVolume] = useState(1);
  const [levels, setLevels] = useState<Array<{ index: number; height: number }>>([]);
  const [levelIndex, setLevelIndex] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [thumbs, setThumbs] = useState<ThumbCue[]>([]);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Ad state
  const [ad, setAd] = useState<VastAd | null>(null);
  const [adRemaining, setAdRemaining] = useState(0);
  const [adSkippable, setAdSkippable] = useState(false);
  const firedQuartiles = useRef<Set<string>>(new Set());
  const popFired = useRef(false);

  // Watch accounting. `watched` counts seconds actually played, not wall clock
  // and not seek position - scrubbing to the end must not manufacture a view.
  const watchedRef = useRef(0);
  const lastTickRef = useRef(0);

  // ---- Thumbnails ----
  useEffect(() => {
    if (!data.video.thumbnails) return;
    let cancelled = false;
    loadThumbnails(data.video.thumbnails).then((c) => !cancelled && setThumbs(c));
    return () => { cancelled = true; };
  }, [data.video.thumbnails]);

  // ---- Heartbeats ----
  // The server counts a view from these, so cadence and monotonic position are
  // what it validates. A single fire-and-forget beacon at load would be
  // trivially forgeable; a sequence over time is far less so.
  useEffect(() => {
    if (!data || phase !== "playing") return;
    const token = data.session.token;

    const send = () => {
      const video = videoRef.current;
      if (!video) return;
      fetch(`${API_URL}/api/track/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          position: video.currentTime,
          watched: watchedRef.current,
          quality: levels.find((l) => l.index === levelIndex)?.height ?? 0,
          buffering: video.readyState < 3,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    const timer = setInterval(send, HEARTBEAT_SECONDS * 1000);
    // A final report on unload, so a viewer who closes the tab still has their
    // watch time counted rather than silently discarded.
    const onHide = () => { if (document.visibilityState === "hidden") send(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      send();
    };
  }, [data, phase, levelIndex, levels]);

  // ---- Attach HLS ----
  const attachHls = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !data) return;

    const manifest = data.playback.manifest;
    // Safari plays HLS natively and does it better than MSE; everywhere else
    // needs hls.js.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = manifest;
      return;
    }

    const { default: Hls } = await import("hls.js");
    if (!Hls.isSupported()) {
      setError("HLS is not supported in this browser");
      setPhase("error");
      return;
    }

    const hls = new Hls({
      // Modest buffer: pre-buffering far ahead of the viewer spends bandwidth
      // on segments a bouncing viewer will never watch, and bandwidth is the
      // single largest cost per view.
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      capLevelToPlayerSize: true,
      startLevel: -1,
    });
    hls.loadSource(manifest);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setLevels(hls.levels.map((l, i) => ({ index: i, height: l.height })));
      setLevelIndex(-1);
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => setLevelIndex(hls.autoLevelEnabled ? -1 : d.level));
    // Recovery has to be bounded and codec failures have to be named.
    // MANIFEST_INCOMPATIBLE_CODECS_ERROR is reported as a MEDIA_ERROR, so a
    // blanket recoverMediaError() on that type retries forever against a
    // browser that will never decode the stream - the player just hangs with
    // no message, which is the worst possible failure mode for a viewer.
    let mediaRecoveries = 0;
    let networkRetries = 0;
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;

      if (d.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) {
        setError("This browser cannot play this video (H.264/AAC not supported).");
        setPhase("error");
        hls.destroy();
        return;
      }

      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
        networkRetries += 1;
        hls.startLoad();
        return;
      }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
        mediaRecoveries += 1;
        hls.recoverMediaError();
        return;
      }

      setError("Playback failed. Try reloading.");
      setPhase("error");
      hls.destroy();
    });
    hlsRef.current = hls as never;
  }, [data]);

  useEffect(() => () => { hlsRef.current?.destroy(); }, []);

  // ---- Pre-roll ----
  const startPreroll = useCallback(async (): Promise<boolean> => {
    if (!data) return false;
    const placements = data.ads.PREROLL;
    if (!placements || placements.length === 0) return false;

    // Walk the waterfall: first network that returns a usable creative wins,
    // and a no-fill is reported so the revenue report reflects reality.
    for (const placement of placements) {
      const loaded = await loadVast(placement.payload, data.playback.maxHeight);
      if (loaded) {
        reportImpression(data.session.token, placement.networkId, "PREROLL", true);
        fireBeacons(loaded.impressions);
        setAd(loaded);
        setPhase("preroll");
        return true;
      }
      reportImpression(data.session.token, placement.networkId, "PREROLL", false);
    }
    return false;
  }, [data]);

  const finishPreroll = useCallback(() => {
    setAd(null);
    setAdSkippable(false);
    firedQuartiles.current.clear();
    setPhase("playing");
    void attachHls().then(() => videoRef.current?.play().catch(() => undefined));
  }, [attachHls]);

  // ---- Start playback (must stay inside the user gesture for the pop-under) ----
  const start = useCallback(() => {
    if (!data) return;
    if (!popFired.current) {
      popFired.current = true;
      firePopunder(data.ads.POPUNDER, data.session.token);
    }
    void (async () => {
      const hasAd = await startPreroll();
      if (!hasAd) {
        setPhase("playing");
        await attachHls();
        videoRef.current?.play().catch(() => undefined);
      }
    })();
  }, [data, startPreroll, attachHls]);

  // ---- Ad video wiring ----
  useEffect(() => {
    const adVideo = adVideoRef.current;
    if (!ad || phase !== "preroll" || !adVideo) return;

    adVideo.src = ad.mediaUrl;
    adVideo.muted = muted;
    adVideo.play().catch(() => finishPreroll());

    const onTime = () => {
      const remaining = (ad.durationSec ?? adVideo.duration) - adVideo.currentTime;
      setAdRemaining(Math.max(0, Math.ceil(remaining)));
      if (ad.skipOffsetSec !== null && adVideo.currentTime >= ad.skipOffsetSec) setAdSkippable(true);

      const total = ad.durationSec ?? adVideo.duration;
      if (!total) return;
      const pct = adVideo.currentTime / total;
      const quartiles: Array<[string, number]> = [
        ["start", 0], ["firstQuartile", 0.25], ["midpoint", 0.5], ["thirdQuartile", 0.75],
      ];
      for (const [event, threshold] of quartiles) {
        if (pct >= threshold && !firedQuartiles.current.has(event)) {
          firedQuartiles.current.add(event);
          fireBeacons(ad.tracking[event]);
        }
      }
    };
    const onEnded = () => { fireBeacons(ad.tracking.complete); finishPreroll(); };
    const onError = () => finishPreroll();

    adVideo.addEventListener("timeupdate", onTime);
    adVideo.addEventListener("ended", onEnded);
    adVideo.addEventListener("error", onError);
    return () => {
      adVideo.removeEventListener("timeupdate", onTime);
      adVideo.removeEventListener("ended", onEnded);
      adVideo.removeEventListener("error", onError);
    };
  }, [ad, phase, muted, finishPreroll]);

  // ---- Content video wiring ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      setCurrent(video.currentTime);
      // Accumulate only forward, real-time progress. A jump larger than a
      // couple of seconds is a seek, not watching, and is not credited.
      const delta = video.currentTime - lastTickRef.current;
      if (delta > 0 && delta < 2) watchedRef.current += delta;
      lastTickRef.current = video.currentTime;

      if (video.currentTime > 10 && !overlayVisible) setOverlayVisible(true);
      if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const onMeta = () => setDuration(video.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onSeeked = () => { lastTickRef.current = video.currentTime; };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [overlayVisible]);

  // ---- Controls ----
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (phase === "idle") return start();
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [phase, start]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (video && Number.isFinite(time)) video.currentTime = Math.max(0, Math.min(time, video.duration || 0));
  }, []);

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * (duration || 0));
  };

  const onBarHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHover({ x: ratio * rect.width, time: ratio * (duration || 0) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "playing") return;
      const video = videoRef.current;
      if (!video) return;
      const handlers: Record<string, () => void> = {
        " ": () => togglePlay(),
        k: () => togglePlay(),
        ArrowRight: () => seekTo(video.currentTime + 5),
        ArrowLeft: () => seekTo(video.currentTime - 5),
        j: () => seekTo(video.currentTime - 10),
        l: () => seekTo(video.currentTime + 10),
        m: () => { video.muted = !video.muted; setMuted(video.muted); },
        f: () => void toggleFullscreen(),
      };
      const handler = handlers[e.key];
      if (handler) { e.preventDefault(); handler(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, togglePlay, seekTo]);

  const toggleFullscreen = async () => {
    const wrap = videoRef.current?.parentElement;
    if (!wrap) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await wrap.requestFullscreen().catch(() => undefined);
  };

  const setQuality = (index: number) => {
    const hls = hlsRef.current as unknown as { currentLevel: number; autoLevelEnabled: boolean } | null;
    if (hls) hls.currentLevel = index;
    setLevelIndex(index);
    setMenuOpen(false);
  };

  // ---- Render ----
  if (phase === "error") {
    return <div className={styles.wrap}><div className={styles.center}>{error ?? "Unavailable"}</div></div>;
  }

  const hoverCue = hover ? cueAt(thumbs, hover.time) : null;

  return (
    <div className={styles.wrap}>
      <video
        ref={videoRef}
        className={styles.video}
        poster={data.video.poster ?? undefined}
        playsInline
        muted={muted}
        onClick={togglePlay}
        style={{ display: phase === "preroll" ? "none" : "block" }}
      />

      {phase === "preroll" && (
        <>
          <video ref={adVideoRef} className={styles.video} playsInline muted={muted} />
          <div className={styles.adBadge}>Ad · {adRemaining}s</div>
          {ad?.clickThrough && (
            <a
              className={styles.adClickthrough}
              href={ad.clickThrough}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => fireBeacons(ad.clickTracking)}
              aria-label="Visit advertiser"
            />
          )}
          {adSkippable && (
            <button className={styles.adSkip} onClick={() => { fireBeacons(ad?.tracking.skip); finishPreroll(); }}>
              Skip ad ›
            </button>
          )}
        </>
      )}

      {phase === "gate" && (
        <div className={styles.gate}>
          <div className={styles.gateInner}>
            <strong>Adult content</strong>
            <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
              You must be 18 or older, and of legal age in your jurisdiction, to view this.
            </p>
            <button className={styles.gateBtn} onClick={() => setPhase("idle")}>I am 18 or older</button>
          </div>
        </div>
      )}

      {phase === "idle" && (
        <div className={styles.center}>
          <button className={styles.bigPlay} onClick={start} aria-label="Play">▶</button>
        </div>
      )}

      {overlayVisible && phase === "playing" && data.ads.OVERLAY && (
        <div className={styles.adOverlay}>
          <div className={styles.adOverlayInner}>
            <button className={styles.adClose} onClick={() => setOverlayVisible(false)} aria-label="Close ad">×</button>
            <AdSlot placements={data.ads.OVERLAY} token={data.session.token} slotType="OVERLAY" />
          </div>
        </div>
      )}

      {phase === "playing" && (
        <div className={styles.controls} data-visible={!playing}>
          <div className={styles.bar} onClick={onBarClick} onMouseMove={onBarHover} onMouseLeave={() => setHover(null)}>
            <div className={styles.track}>
              <div className={styles.buffered} style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
              <div className={styles.progress} style={{ width: `${duration ? (current / duration) * 100 : 0}%` }} />
            </div>
            {hover && hoverCue && (
              <div
                className={styles.thumb}
                style={{
                  left: hover.x, width: hoverCue.w, height: hoverCue.h,
                  backgroundImage: `url(${hoverCue.url})`,
                  backgroundPosition: `-${hoverCue.x}px -${hoverCue.y}px`,
                }}
              >
                <span className={styles.thumbTime}>{formatTime(hover.time)}</span>
              </div>
            )}
          </div>

          <div className={styles.row}>
            <button className={styles.btn} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <button
              className={styles.btn}
              onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <input
              type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v); setMuted(v === 0);
                if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
              }}
              style={{ width: 70 }} aria-label="Volume"
            />
            <span className={styles.time}>{formatTime(current)} / {formatTime(duration)}</span>
            <div className={styles.spacer} />
            {levels.length > 1 && (
              <button className={styles.btn} onClick={() => setMenuOpen((v) => !v)} aria-label="Quality">
                {levelIndex === -1 ? "Auto" : `${levels.find((l) => l.index === levelIndex)?.height ?? ""}p`}
              </button>
            )}
            <button className={styles.btn} onClick={() => void toggleFullscreen()} aria-label="Fullscreen">⛶</button>
          </div>

          {menuOpen && (
            <div className={styles.menu}>
              <button className={styles.menuItem} data-active={levelIndex === -1} onClick={() => setQuality(-1)}>Auto</button>
              {[...levels].reverse().map((l) => (
                <button key={l.index} className={styles.menuItem} data-active={levelIndex === l.index} onClick={() => setQuality(l.index)}>
                  {l.height}p
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
