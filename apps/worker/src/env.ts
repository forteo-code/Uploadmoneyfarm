import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  TRANSCODE_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  TRANSCODE_TMP_DIR: z.string().default("./tmp-media"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid worker environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
