import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";

/**
 * S3-compatible driver. Production target is Cloudflare R2 (zero egress is what
 * makes the per-view economics work); MinIO stands in locally and speaks the
 * same API, so nothing below changes between environments.
 */
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

export function sourceKey(videoId: string, ext: string): string {
  return `source/${videoId}/original${ext.startsWith(".") ? ext : "." + ext}`;
}
export function hlsPrefix(videoId: string): string {
  return `hls/${videoId}`;
}
export function posterKey(videoId: string): string {
  return `hls/${videoId}/poster.jpg`;
}

/**
 * Multipart upload. The API never proxies video bytes - the browser PUTs each
 * part straight to storage with a presigned URL. Keeping bytes off the app
 * servers is what lets them stay small while upload volume grows.
 */
export async function startMultipart(key: string, contentType: string) {
  const res = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
  );
  if (!res.UploadId) throw new Error("storage: no UploadId returned");
  return res.UploadId;
}

export async function presignPart(key: string, uploadId: string, partNumber: number, ttl = 3600) {
  return getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: ttl },
  );
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
) {
  return s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

export async function abortMultipart(key: string, uploadId: string) {
  return s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
}

export async function presignGet(key: string, ttl = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttl });
}

export async function putObject(key: string, body: Buffer | string, contentType: string) {
  return s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function headObject(key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  return s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Removes an entire video's derived output. Used by takedowns and pruning. */
export async function deletePrefix(prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
      deleted += keys.length;
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export function publicUrl(key: string): string {
  return `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}
