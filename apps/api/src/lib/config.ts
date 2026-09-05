import { prisma } from "@umf/db";
import { redis } from "./redis.js";

/**
 * Operator policy lives in SystemConfig so content rules, ad aggression and
 * payout terms are changed from the admin console rather than by a deploy.
 *
 * Cached in-process for a few seconds: these are read on every playback and a
 * database round trip per key per view would be absurd, but an operator
 * flipping a switch should still see it take effect quickly.
 */
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { value: unknown; expires: number }>();

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const row = await prisma.systemConfig.findUnique({ where: { key } });
  const value = (row?.value ?? fallback) as T;
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: value as never },
    create: { key, value: value as never },
  });
  cache.delete(key);
  // Other API instances hold their own cache; this nudges them to drop it.
  await redis.publish("config:invalidate", key).catch(() => undefined);
}

export function invalidateConfigCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
