import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LADDER } from "@umf/shared";

/**
 * Per-cap master playlists.
 *
 * The geo quality ceiling has to be enforced server-side. Handing every viewer
 * the full master playlist and asking hls.js to cap itself is not enforcement:
 * the client can ignore it, and an embedded player on someone else's page is
 * exactly where that would happen. Instead the transcode emits one master per
 * cap level containing only the rungs at or below it, and playback hands the
 * viewer the master their country is entitled to.
 *
 * These are static files, so they stay CDN-cacheable - no per-request playlist
 * rendering on the origin.
 */

type StreamEntry = { attrs: string; uri: string; height: number };

function parseMaster(content: string): { header: string[]; entries: StreamEntry[] } {
  const lines = content.split(/\r?\n/);
  const header: string[] = [];
  const entries: StreamEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const uri = lines[++i]?.trim() ?? "";
      if (!uri) continue;
      // Prefer the declared RESOLUTION; fall back to the "<height>p/" path
      // segment ffmpeg's var_stream_map naming gives us.
      const res = /RESOLUTION=\d+x(\d+)/.exec(line);
      const fromPath = /(\d+)p\//.exec(uri);
      const height = Number(res?.[1] ?? fromPath?.[1] ?? 0);
      entries.push({ attrs: line, uri, height });
    } else if (line.startsWith("#") && !line.startsWith("#EXT-X-STREAM-INF")) {
      header.push(line);
    }
  }
  return { header, entries };
}

/**
 * Writes master_<cap>.m3u8 for every cap in the ladder that admits at least one
 * rung. Returns the caps actually written so playback can fall back safely.
 */
export async function writeCappedMasters(outDir: string): Promise<number[]> {
  const masterPath = path.join(outDir, "master.m3u8");
  const raw = await readFile(masterPath, "utf8");
  const { header, entries } = parseMaster(raw);
  if (entries.length === 0) throw new Error("master playlist has no stream entries");

  const written: number[] = [];
  for (const rung of LADDER) {
    const included = entries.filter((e) => e.height > 0 && e.height <= rung.height);
    if (included.length === 0) continue;

    const body = [
      ...(header.length > 0 ? header : ["#EXTM3U", "#EXT-X-VERSION:6"]),
      ...included.flatMap((e) => [e.attrs, e.uri]),
      "",
    ].join("\n");

    await writeFile(path.join(outDir, `master_${rung.height}.m3u8`), body, "utf8");
    written.push(rung.height);
  }
  return written;
}

/** Highest available cap at or below `requested`; the lowest if none fit. */
export function resolveCap(available: number[], requested: number): number {
  const eligible = available.filter((h) => h <= requested);
  if (eligible.length > 0) return Math.max(...eligible);
  return Math.min(...available);
}
