import pino from "pino";
import { env, isProd } from "../env.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
  // Never log raw IPs or tokens. Everything identifying is hashed upstream.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
    remove: true,
  },
  ...(isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});

export const baseLogger = logger;
export { env };
