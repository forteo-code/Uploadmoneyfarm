# The Next.js front end.
#
# Uses Next's standalone output, which traces the modules the server actually
# imports and emits a runnable bundle. Copying the workspace node_modules
# instead would multiply the image size for no benefit.

FROM node:22-alpine AS builder
WORKDIR /app

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
COPY apps/web/ apps/web/

RUN npm run build -w @dropreel/shared

# Baked in at build time: Next inlines NEXT_PUBLIC_* into the client bundle, so
# this cannot be supplied at run time. Changing the API origin means rebuilding
# this image, which is why it is an explicit build arg rather than a surprise.
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build -w @dropreel/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
