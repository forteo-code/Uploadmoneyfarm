# The transcode worker.
#
# Same build as the API with one difference that matters: this image needs
# FFmpeg, which is most of its size. It is also the only service that should be
# scaled horizontally — encoding is the CPU cost centre.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Prisma's schema and query engines link against OpenSSL. The slim image does
# not ship it, and without it `prisma generate` and `prisma migrate deploy`
# fail with an engine error that does not name the cause. The migrate stage
# inherits this, so it belongs here and not only in the runtime stage.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
# Optional CA for build machines behind a TLS-intercepting proxy (corporate
# egress, CI sandboxes). Mounted as a build secret so it is used during install
# and never lands in a layer:
#   docker build --secret id=ca_cert,src=/path/to/ca-bundle.crt ...
# Without the secret this is an ordinary install.
RUN --mount=type=secret,id=ca_cert \
    sh -c 'if [ -s /run/secrets/ca_cert ]; then npm config set cafile /run/secrets/ca_cert; fi; \
           npm ci --ignore-scripts --no-audit --no-fund'

COPY packages/ packages/
COPY apps/worker/ apps/worker/

RUN --mount=type=secret,id=ca_cert \
    sh -c 'if [ -s /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi; \
           npm run build -w @dropreel/shared && npm run build -w @dropreel/db && npm run build -w @dropreel/worker'

FROM builder AS pruned
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma's query engine links against OpenSSL, which the slim image does not
# ship. Without this the client fails at first query, not at build.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ffmpeg brings libx264, libx265 and libaom; ffprobe comes with it and is what
# the ingest step uses to read duration and stream layout before encoding.
RUN --mount=type=secret,id=ca_cert \
    sh -c 'if [ -s /run/secrets/ca_cert ]; then cat /run/secrets/ca_cert >> /etc/ssl/certs/ca-certificates.crt; fi; \
           apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*'

COPY --from=pruned --chown=node:node /app/node_modules ./node_modules
COPY --from=pruned --chown=node:node /app/package.json ./package.json
COPY --from=pruned --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=pruned --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=pruned --chown=node:node /app/packages/db/dist ./packages/db/dist
COPY --from=pruned --chown=node:node /app/packages/db/package.json ./packages/db/
COPY --from=pruned --chown=node:node /app/packages/db/prisma ./packages/db/prisma
COPY --from=pruned --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=pruned --chown=node:node /app/apps/worker/package.json ./apps/worker/

# Scratch space for the encoder. Owned by node because the process is not root.
RUN mkdir -p /tmp/dropreel && chown node:node /tmp/dropreel

USER node
CMD ["node", "apps/worker/dist/index.js"]
