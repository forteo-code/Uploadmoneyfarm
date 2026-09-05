import { Redis } from "ioredis";
import { env } from "../env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/** BullMQ requires its own connection with blocking commands enabled. */
export function createQueueConnection() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
