export type ThumbCue = { start: number; end: number; url: string; x: number; y: number; w: number; h: number };

function parseTimestamp(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return Number(value) || 0;
}

/** Parses the sprite WebVTT the transcoder emits (media#xywh=x,y,w,h). */
export async function loadThumbnails(vttUrl: string): Promise<ThumbCue[]> {
  try {
    const res = await fetch(vttUrl);
    if (!res.ok) return [];
    const base = new URL(vttUrl);
    const cues: ThumbCue[] = [];
    const lines = (await res.text()).split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.includes("-->")) continue;
      const [startRaw, endRaw] = line.split("-->");
      const target = lines[++i]?.trim();
      if (!target) continue;

      const [pathPart, fragment] = target.split("#");
      const coords = /xywh=(\d+),(\d+),(\d+),(\d+)/.exec(fragment ?? "");
      if (!coords || !pathPart) continue;

      cues.push({
        start: parseTimestamp(startRaw!),
        end: parseTimestamp(endRaw!),
        url: new URL(pathPart, base).toString(),
        x: Number(coords[1]), y: Number(coords[2]),
        w: Number(coords[3]), h: Number(coords[4]),
      });
    }
    return cues;
  } catch {
    return [];
  }
}

export function cueAt(cues: ThumbCue[], time: number): ThumbCue | null {
  for (const cue of cues) if (time >= cue.start && time < cue.end) return cue;
  return cues[cues.length - 1] ?? null;
}
