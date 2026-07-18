# syntax=docker/dockerfile:1
#
# Multi-stage image for the ShowTrackr SvelteKit app (Node adapter).
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
# Stage 1 — build: install ALL deps and build the SvelteKit app
# ----------------------------------------------------------------------------
FROM base AS build
# Workspace + package manifests first for better layer caching.
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile
# Sources required to build the web app and its workspace dependency.
COPY packages/db ./packages/db
COPY apps/web ./apps/web
# @showtrackr/db ships compiled: it MUST be built (tsc -> packages/db/dist) BEFORE the
# web build, which imports it via its dist/ entrypoints. Order matters.
RUN pnpm --filter @showtrackr/db run build
# adapter-node emits a self-contained server at apps/web/build/index.js
RUN pnpm --filter @showtrackr/web run build

# ----------------------------------------------------------------------------
# Stage 2 — prod-deps: production-only dependency tree (flat, via node-linker=hoisted)
# ----------------------------------------------------------------------------
FROM base AS prod-deps
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
# packages/db source is needed because @showtrackr/db is a workspace dependency
# (it is symlinked into node_modules by the install).
COPY packages/db ./packages/db
RUN pnpm install --frozen-lockfile --prod

# ----------------------------------------------------------------------------
# Stage 3 — runtime: minimal image running the built server as non-root
# ----------------------------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
# corepack/pnpm kept available so the `migrate` service can reuse this image.
RUN corepack enable
WORKDIR /app
# Run as the unprivileged `node` user (uid 1000) that ships with the base image.
# Flat production node_modules (external deps) come from the prod-deps stage.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# The db package MUST come from the `build` stage so it carries the COMPILED dist/
# (prod-deps never runs tsc). This provides dist/migrate.js for the migrate service
# and dist/index.js for the @showtrackr/db symlink in node_modules. drizzle/ (the SQL
# migrations, resolved as ../drizzle relative to dist/migrate.js) travels with it.
COPY --from=build --chown=node:node /app/packages/db ./packages/db
COPY --from=prod-deps --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# Built application.
COPY --from=build --chown=node:node /app/apps/web/build ./build
COPY --from=build --chown=node:node /app/apps/web/package.json ./package.json
USER node
EXPOSE 3000
# adapter-node reads HOST and PORT from the environment.
CMD ["node", "build/index.js"]
