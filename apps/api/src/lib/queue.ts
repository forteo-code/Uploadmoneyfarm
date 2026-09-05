import { Queue } from "bullmq";
import { createQueueConnection } from "./redis.js";

export const TRANSCODE_QUEUE = "transcode";

export type TranscodeJob = {
  videoId: string;
  sourceKey: string;
  attempt?: number;
};

export const transcodeQueue = new Queue<TranscodeJob>(TRANSCODE_QUEUE, {
  connection: createQueueConnection(),
  defaultJobOptions: {
    // Transcodes are expensive and mostly fail for deterministic reasons (bad
    // container, unsupported codec). Three tries with backoff, then the job
    // lands in the failed set for the admin queue rather than looping forever.
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
