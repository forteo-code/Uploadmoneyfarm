import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://127.0.0.1:4000"),
  WEB_PUBLIC_URL: z.string().url().default("http://127.0.0.1:3000"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  PLAYBACK_TOKEN_SECRET: z.string().min(32),
  IP_HASH_SALT: z.string().min(32),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  MEDIA_PUBLIC_BASE_URL: z.string().url(),

  GEOIP_COUNTRY_DB: z.string().optional(),
  GEOIP_ASN_DB: z.string().optional(),

  DMCA_AGENT_EMAIL: z.string().email().default("dmca@example.com"),
  DMCA_AGENT_NAME: z.string().default("Designated Agent"),
  DMCA_AGENT_ADDRESS: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
