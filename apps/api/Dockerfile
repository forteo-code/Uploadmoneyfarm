# The API image.
#
# Built from the repo root so the workspace packages (@dropreel/db,
# @dropreel/shared) resolve the same way they do in development. Everything is
# compiled in a builder stage and only the runtime artefacts are copied out, so
# the shipped image carries no TypeScript, no source maps and no build tools.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Prisma's schema and query engines link against OpenSSL. The slim image does
# not ship it, and without it `prisma generate` and `prisma migrate deploy`
# fail with an engine error that does not name the cause. The migrate stage
# inherits this, so it belongs here and not only in the runtime stage.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Manifests first: this layer only invalidates when a dependency changes, so an
# ordinary code change reuses the install layer.
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
COPY apps/api/ apps/api/

# The Prisma client is generated code; it has to exist before anything that
# imports @dropreel/db will typecheck.
RUN --mount=type=secret,id=ca_cert \
    sh -c 'if [ -s /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi; \
           npm run build -w @dropreel/shared && npm run build -w @dropreel/db && npm run build -w @dropreel/api'

# Migrations run from their own image because the Prisma CLI is a dev
# dependency: it exists here, in the builder, and is deliberately absent from
# the runtime image. Compose runs this to completion before the API starts.
FROM builder AS migrate
WORKDIR /app
CMD ["npx", "prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"]

# Drop dev dependencies from the tree the runtime stage copies forward.
FROM builder AS pruned
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma's query engine links against OpenSSL, which the slim image does not
# ship. Without this the client fails at first query, not at build.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. The node image ships one; we do not create our own.
COPY --from=pruned --chown=node:node /app/node_modules ./node_modules
COPY --from=pruned --chown=node:node /app/package.json ./package.json
COPY --from=pruned --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=pruned --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=pruned --chown=node:node /app/packages/db/dist ./packages/db/dist
COPY --from=pruned --chown=node:node /app/packages/db/package.json ./packages/db/
COPY --from=pruned --chown=node:node /app/packages/db/prisma ./packages/db/prisma
COPY --from=pruned --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=pruned --chown=node:node /app/apps/api/package.json ./apps/api/

USER node
EXPOSE 4000

# No shell wrapper: PID 1 is node, so SIGTERM from `docker stop` reaches the
# process and in-flight requests drain instead of being killed at the timeout.
CMD ["node", "apps/api/dist/index.js"]
