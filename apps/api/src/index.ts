import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env, isProd } from "./env.js";
import { logger } from "./lib/logger.js";
import { initGeo } from "./lib/geoip.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { uploadsRouter } from "./routes/uploads.js";
import { videosRouter } from "./routes/videos.js";
import { playbackRouter } from "./routes/playback.js";
import { trackRouter } from "./routes/track.js";
import { adsRouter } from "./routes/ads.js";
import { meRouter } from "./routes/me.js";
import { dmcaRouter } from "./routes/dmca.js";
import { adminRouter } from "./routes/admin.js";

const app = express();

// Behind a CDN. Required for X-Forwarded-For to resolve to the real client,
// which every geo and fraud decision depends on.
app.set("trust proxy", true);

app.use(
  helmet({
    // The player is embedded on third-party sites by design - that embed
    // traffic is the distribution model - so framing must stay open here.
    frameguard: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    // Ad network tags are injected at runtime from operator config, so a strict
    // script-src is not achievable on ad-bearing pages. CSP for those is set
    // per-response in the web app; the API itself serves no HTML.
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: isProd ? [env.WEB_PUBLIC_URL] : true,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req: { url?: string }) => req.url === "/health" } }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/videos", videosRouter);
app.use("/api/playback", playbackRouter);
app.use("/api/track", trackRouter);
app.use("/api/ads", adsRouter);
app.use("/api/me", meRouter);
app.use("/api/dmca", dmcaRouter);
app.use("/api/admin", adminRouter);

app.use(notFound);
app.use(errorHandler);

async function main() {
  await initGeo();
  app.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT }, "api listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
