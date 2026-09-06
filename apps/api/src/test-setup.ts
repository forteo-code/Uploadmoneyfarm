/**
 * Test environment defaults.
 *
 * env.ts validates the environment at import time and calls process.exit(1) if
 * anything is missing — correct for a server that should refuse to boot
 * half-configured, but it means importing any module that transitively pulls in
 * env.ts kills the test run with an exit code and no useful message.
 *
 * Vitest runs this before the test module is imported, so these defaults are in
 * place by the time that validation happens. Real values in the environment win,
 * which keeps `set -a; . .env` working for anyone pointing a test at a live
 * service. Nothing here reaches a network: the URLs are syntactically valid and
 * deliberately unroutable.
 */

const defaults: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379",
  JWT_SECRET: "test-secret-000000000000000000000000000000000000000000",
  PLAYBACK_TOKEN_SECRET: "test-secret-111111111111111111111111111111111111111111",
  IP_HASH_SALT: "test-secret-222222222222222222222222222222222222222222",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "auto",
  S3_BUCKET: "test-media",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  MEDIA_PUBLIC_BASE_URL: "http://127.0.0.1:9000/test-media",
  API_PORT: "4000",
  API_PUBLIC_URL: "http://127.0.0.1:4000",
  WEB_PUBLIC_URL: "http://127.0.0.1:3000",
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
