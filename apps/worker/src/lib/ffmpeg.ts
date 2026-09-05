import { spawn } from "node:child_process";
import { env } from "../env.js";
import { LADDER, HLS_SEGMENT_SECONDS } from "@umf/shared";
import { logger } from "./logger.js";

export type ProbeResult = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  bitrate: number | null;
};

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    // ffmpeg is chatty on stderr; keep only the tail so a failure message
    // survives without holding a whole encode log in memory.
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Probe before doing anything else. Uploads are arbitrary user files: broken
 * containers, streams that claim one codec and carry another, zero-duration
 * junk. A source that will not probe is rejected here rather than wasting an
 * encode slot on it.
 */
export async function probe(inputPath: string): Promise<ProbeResult> {
  const { stdout } = await run(
    env.FFPROBE_PATH,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath],
    120_000,
  );
  const data = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("probe: no video stream");

  // r_frame_rate arrives as "30000/1001"; guard against a zero denominator.
  const rate = String(video.r_frame_rate ?? "0/1").split("/");
  const num = Number(rate[0] ?? 0);
  const den = Number(rate[1] ?? 1);
  const fps = den > 0 && num > 0 ? num / den : 0;

  const durationSec = Number(data.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("probe: no usable duration");

  const width = Number(video.width ?? 0);
  const height = Number(video.height ?? 0);
  if (width <= 0 || height <= 0) throw new Error("probe: no usable dimensions");

  const bitrateRaw = Number(data.format?.bit_rate ?? 0);

  return {
    durationSec,
    width,
    height,
    fps: fps > 0 ? fps : 25,
    videoCodec: (video.codec_name as string) ?? null,
    audioCodec: (audio?.codec_name as string) ?? null,
    hasAudio: Boolean(audio),
    bitrate: Number.isFinite(bitrateRaw) && bitrateRaw > 0 ? bitrateRaw : null,
  };
}

export type LadderRung = (typeof LADDER)[number];

/**
 * Choose which rungs to encode.
 *
 * Two caps apply, and both are cost controls rather than quality decisions:
 *   - never encode above the source resolution (upscaling spends bandwidth to
 *     deliver no extra detail);
 *   - never exceed maxHeight, which defaults to 720 and is what keeps a view
 *     from costing more to deliver than its ads return.
 */
export function selectRungs(sourceHeight: number, maxHeight: number): LadderRung[] {
  const ceiling = Math.min(sourceHeight, maxHeight);
  const rungs = LADDER.filter((r) => r.height <= ceiling);
  // Always emit at least the lowest rung, even for a tiny source, so there is
  // something to serve.
  return rungs.length > 0 ? [...rungs] : [LADDER[0]!];
}

/**
 * Single-pass, multi-output HLS encode.
 *
 * One ffmpeg invocation decodes the source once and splits it across every
 * rung. Running one process per rendition would be simpler but would decode
 * the source N times, and decode is the dominant CPU cost in the pipeline.
 */
export async function encodeHls(
  inputPath: string,
  outDir: string,
  rungs: LadderRung[],
  probeResult: ProbeResult,
): Promise<void> {
  const { hasAudio, fps } = probeResult;

  // Keyframe interval pinned to the segment length so every segment starts on
  // an IDR frame and players can switch rungs cleanly at any boundary.
  const gop = Math.max(2, Math.round(fps * HLS_SEGMENT_SECONDS));

  const splitLabels = rungs.map((_, i) => `[v${i}]`).join("");
  // scale=w=-2 preserves aspect ratio AND rounds width to an even number,
  // which libx264 requires. force_original_aspect_ratio must NOT be combined
  // with it: that flag overrides the even-rounding and yields odd widths
  // (e.g. 853x480) that the encoder rejects outright.
  const scaleFilters = rungs
    .map((r, i) => `[v${i}]scale=w=-2:h=${r.height}:flags=bicubic,setsar=1[v${i}out]`)
    .join(";");
  const filterComplex = `[0:v]split=${rungs.length}${splitLabels};${scaleFilters}`;

  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputPath,
    "-filter_complex", filterComplex,
  ];

  rungs.forEach((r, i) => {
    args.push(
      "-map", `[v${i}out]`,
      `-c:v:${i}`, "libx264",
      `-profile:v:${i}`, r.height >= 720 ? "high" : "main",
      `-preset:v:${i}`, "veryfast",
      `-crf:v:${i}`, String(r.crf),
      `-maxrate:v:${i}`, `${r.videoKbps}k`,
      `-bufsize:v:${i}`, `${r.videoKbps * 2}k`,
      `-g:v:${i}`, String(gop),
      `-keyint_min:v:${i}`, String(gop),
      `-sc_threshold:v:${i}`, "0",
    );
  });

  if (hasAudio) {
    rungs.forEach((r, i) => {
      args.push("-map", "a:0", `-c:a:${i}`, "aac", `-b:a:${i}`, `${r.audioKbps}k`, `-ac:a:${i}`, "2");
    });
  }

  // var_stream_map pairs each video output with its audio output. Without
  // audio the map is video-only, which is what silent uploads need.
  const varStreamMap = rungs
    .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.height}p` : `v:${i},name:${r.height}p`))
    .join(" ");

  args.push(
    "-f", "hls",
    "-hls_time", String(HLS_SEGMENT_SECONDS),
    "-hls_playlist_type", "vod",
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", `${outDir}/%v/seg_%05d.ts`,
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", varStreamMap,
    `${outDir}/%v/index.m3u8`,
  );

  logger.debug({ rungs: rungs.map((r) => r.height), hasAudio }, "starting hls encode");
  // Six-hour ceiling: long enough for a feature-length source on a modest box,
  // short enough that a wedged encode cannot hold a worker slot indefinitely.
  await run(env.FFMPEG_PATH, args, 6 * 60 * 60 * 1000);
}

/** Poster frame, taken 10% in to avoid black leader frames. */
export async function extractPoster(inputPath: string, outPath: string, durationSec: number): Promise<void> {
  const at = Math.max(1, Math.min(durationSec * 0.1, durationSec - 1));
  await run(
    env.FFMPEG_PATH,
    ["-y", "-hide_banner", "-loglevel", "error", "-ss", at.toFixed(2), "-i", inputPath,
     "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "4", outPath],
    120_000,
  );
}

/**
 * Seek-preview sprite sheet: one tile per interval, tiled into a grid, plus a
 * WebVTT file mapping timestamps to tile coordinates. One image request beats
 * hundreds of individual thumbnail fetches.
 */
export async function extractSprite(
  inputPath: string,
  outPath: string,
  durationSec: number,
): Promise<{ interval: number; columns: number; rows: number; tileWidth: number; tileHeight: number; count: number }> {
  const tileWidth = 160;
  const tileHeight = 90;
  const targetTiles = Math.min(100, Math.max(10, Math.floor(durationSec / 10)));
  const interval = Math.max(1, durationSec / targetTiles);
  const columns = 10;
  const rows = Math.ceil(targetTiles / columns);

  await run(
    env.FFMPEG_PATH,
    ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath,
     "-vf", `fps=1/${interval.toFixed(4)},scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=increase,crop=${tileWidth}:${tileHeight},tile=${columns}x${rows}`,
     "-frames:v", "1", "-q:v", "5", outPath],
    30 * 60 * 1000,
  );

  return { interval, columns, rows, tileWidth, tileHeight, count: targetTiles };
}

export function buildSpriteVtt(
  spriteUrl: string,
  meta: { interval: number; columns: number; tileWidth: number; tileHeight: number; count: number },
  durationSec: number,
): string {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
  };

  const lines = ["WEBVTT", ""];
  for (let i = 0; i < meta.count; i++) {
    const start = i * meta.interval;
    if (start >= durationSec) break;
    const end = Math.min((i + 1) * meta.interval, durationSec);
    const x = (i % meta.columns) * meta.tileWidth;
    const y = Math.floor(i / meta.columns) * meta.tileHeight;
    lines.push(`${fmt(start)} --> ${fmt(end)}`);
    lines.push(`${spriteUrl}#xywh=${x},${y},${meta.tileWidth},${meta.tileHeight}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Raw 32x32 greyscale frame, the input to the perceptual hash. Piped as
 * rawvideo so there is no image decoder in the path.
 */
export function extractGrayFrame(inputPath: string, atSeconds: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.FFMPEG_PATH, [
      "-hide_banner", "-loglevel", "error",
      "-ss", atSeconds.toFixed(2),
      "-i", inputPath,
      "-frames:v", "1",
      "-vf", "scale=32:32,format=gray",
      "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("extractGrayFrame timed out"));
    }, 120_000);

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`extractGrayFrame exited ${code}: ${stderr.slice(-500)}`));
      resolve(Buffer.concat(chunks));
    });
  });
}
