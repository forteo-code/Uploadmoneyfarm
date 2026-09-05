import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { runTranscode, markFailed, type TranscodeJob } from "./transcode.js";

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<TranscodeJob>(
  "transcode",
  async (job: Job<TranscodeJob>) => {
    logger.info({ jobId: job.id, videoId: job.data.videoId, attempt: job.attemptsMade + 1 }, "transcode start");
    await runTranscode(job.data);
  },
  {
    connection,
    // Transcoding is CPU-bound: concurrency above core count only adds context
    // switching. Scale by adding worker containers, not by raising this.
    concurrency: env.TRANSCODE_CONCURRENCY,
    // A long encode must not be reclaimed mid-run as stalled.
    lockDuration: 30 * 60 * 1000,
    stalledInterval: 5 * 60 * 1000,
  },
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id, videoId: job.data.videoId }, "transcode completed");
});

worker.on("failed", async (job, err) => {
  if (!job) return;
  const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
  logger.error(
    { jobId: job.id, videoId: job.data.videoId, attempt: job.attemptsMade, isFinalAttempt, err: err.message },
    "transcode failed",
  );
  // Only surface FAILED to the uploader once retries are genuinely exhausted;
  // a transient storage blip should not look like a rejected upload.
  if (isFinalAttempt) await markFailed(job.data.videoId, err.message);
});

worker.on("error", (err) => logger.error({ err }, "worker error"));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down; finishing in-flight jobs");
  await worker.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

logger.info({ concurrency: env.TRANSCODE_CONCURRENCY }, "transcode worker ready");
