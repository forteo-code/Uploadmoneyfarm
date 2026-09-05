import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { env } from "../env.js";

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = env.S3_BUCKET;

/** Streams to disk rather than buffering - sources routinely exceed RAM. */
export async function downloadToFile(key: string, destPath: string): Promise<void> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`storage: empty body for ${key}`);
  await pipeline(res.Body as Readable, createWriteStream(destPath));
}

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".vtt": "text/vtt",
};

export function contentTypeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf("."));
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function uploadFile(localPath: string, key: string): Promise<number> {
  const body = await readFile(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(localPath),
      // Segments are immutable once written; let the CDN keep them forever.
      CacheControl: localPath.endsWith(".m3u8")
        ? "public, max-age=60"
        : "public, max-age=31536000, immutable",
    }),
  );
  return body.byteLength;
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
