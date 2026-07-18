# syntax=docker/dockerfile:1
#
# One-shot image for the ShowTrackr GDPR backfill importer CLI.
#
# IMPORTANT: the build context MUST be the repository root (see docker-compose.yml)
# so the pnpm workspace manifest and the @showtrackr/db workspace package are
# available during install and build.

# ----------------------------------------------------------------------------
# Stage 0 — base: Node 20 with pnpm (via corepack) enabled
# ----------------------------------------------------------------------------
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ----------------------------------------------------------------------------
# Stage 1 — build: install deps and (optionally) compile the importer
# ----------------------------------------------------------------------------
FROM base AS build
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml* ./
COPY packages/importer/package.json ./packages/importer/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile
COPY packages/db ./packages/db
COPY packages/importer ./packages/importer
# Build @showtrackr/db first (tsc -> dist) so the importer's own tsc can resolve its
# .d.ts, then build the importer. No `|| true` guard: a failing tsc must fail the image.
RUN pnpm --filter @showtrackr/db run build
RUN pnpm --filter @showtrackr/importer run build

# ----------------------------------------------------------------------------
# Stage 2 — runtime: run the importer as a non-root, one-shot process
# ----------------------------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    GDPR_DATA_DIR=/gdpr-data
RUN corepack enable
WORKDIR /app
# Run as the unprivileged `node` user (uid 1000) that ships with the base image.
# Full dependency tree is kept (the importer's compiled dist/ needs its runtime deps).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/db ./packages/db
COPY --from=build --chown=node:node /app/packages/importer ./packages/importer
USER node
WORKDIR /app/packages/importer
# The importer reads GDPR_DATA_DIR (default /gdpr-data), DATABASE_URL and TMDB_API_KEY.
# Run the compiled CLI directly with node — avoids corepack fetching a pnpm
# version that requires a newer Node than this image ships.
CMD ["node", "dist/index.js"]
