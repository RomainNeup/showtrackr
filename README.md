# MyTVTime

Self-hosted, **mobile-first** TV Time clone: follow shows, mark episodes / shows /
movies as watched, rate them, track watch-time and stats, search & follow content.
Single-user (multi-user-ready schema). **Docker-first** — the only host dependency is Docker.

> 📱 The app is an installable **PWA**: add it to your home screen for a full-screen,
> offline-shell, native-feeling mobile experience.

---

## Quick start

The default setup is **plain HTTP, no domain, no reverse proxy** — the app is
published straight to a host port.

```bash
# 1. Configure
cp .env.example .env
#    then edit .env — at minimum set:
#      TMDB_API_KEY     (free key: https://www.themoviedb.org/settings/api)
#      POSTGRES_PASSWORD + matching DATABASE_URL   (openssl rand -hex 24)
#      SESSION_SECRET   (openssl rand -hex 32)
#    APP_PORT defaults to 8080; PUBLIC_BASE_URL defaults to http://localhost:8080.

# 2. Bring the stack up (builds images, runs migrations, starts db + app)
docker compose up -d

# 3. (Once) import your TV Time GDPR export — expected at ./gdpr-data (repo root)
#    Full walkthrough: see MIGRATION.md
docker compose --profile import run --rm importer
```

Then open **`http://<host-ip>:8080`** on your phone (same LAN) or
`http://localhost:8080` on the host, and log in.

**Coming from TV Time?** See **[MIGRATION.md](MIGRATION.md)** for a step-by-step
guide to requesting your GDPR export and importing your full watch history.

> ⚠️ **PWA over plain HTTP:** service workers require a *secure context*
> (HTTPS or `localhost`). On a bare LAN IP like `http://192.168.1.x:8080` the
> service worker won't register, so install-to-home-screen / offline shell are
> disabled — but the app still works fine as a normal mobile web app. To get the
> full PWA back, enable HTTPS (see "Enabling HTTPS later" below).

---

## Architecture

Default (HTTP-first): the app is published directly to the host.

```
                 ┌──────────────┐
   LAN client ─► │  SvelteKit   │  host :${APP_PORT:-8080} -> container :3000
                 │    (app)     │  SSR + API + cron ──► TMDB API (outbound)
                 └──────┬───────┘
                        │
                 ┌──────▼──────┐
                 │ PostgreSQL  │  persistent volume
                 └─────────────┘

Optional (--profile tls): Caddy fronts the app for automatic HTTPS.

   Internet ─► [ Caddy :443 TLS auto ] ─► app:3000 ─► PostgreSQL
```

### Services (`docker-compose.yml`)

| Service    | Image / build                    | Role |
|------------|----------------------------------|------|
| `db`       | `postgres:16-alpine`             | Database. Persistent named volume `pgdata`, healthchecked. |
| `migrate`  | built from `apps/web/Dockerfile` | One-shot: applies Drizzle migrations, then exits. Runs after `db` is healthy. |
| `app`      | built from `apps/web/Dockerfile` | SvelteKit server (SSR + API + PWA + nightly cron). Published on `${APP_PORT:-8080}`. Starts after `migrate` succeeds. |
| `caddy`    | `caddy:2-alpine`                 | **Optional** reverse proxy + automatic HTTPS on `:443`. Only runs under `--profile tls`. |
| `importer` | built from `packages/importer/Dockerfile` | One-shot GDPR backfill under the `import` profile. Mounts `./gdpr-data` read-only. |

Startup order is enforced with healthchecks + `depends_on`
(`db` healthy → `migrate` completes → `app` starts; with `--profile tls`, `caddy`
waits for `app` to be healthy).

---

## Enabling HTTPS later

Plain HTTP is fine on a trusted LAN, but HTTPS restores the full PWA (installable,
offline shell) and lets cookies be marked `Secure`. Two paths:

### Option A — Tailscale (recommended: no domain, no port-forwarding)

Put the host on your [Tailscale](https://tailscale.com) tailnet and let Tailscale
terminate TLS with a valid `*.ts.net` cert — reachable from your phone anywhere:

```bash
# on the host, with the stack already up on :8080
tailscale serve --bg 8080          # serves https://<host>.<tailnet>.ts.net -> :8080
```

Then set `PUBLIC_BASE_URL=https://<host>.<tailnet>.ts.net` in `.env` and
`docker compose up -d` to pick it up. No `caddy` profile needed. This is the
simplest way to get a secure context (and the PWA) without owning a domain.

### Option B — Caddy + your own domain

If you have a domain pointing at the host (ports 80/443 reachable):

1. Set `PUBLIC_BASE_URL=https://tv.example.com` in `.env` (optionally `ACME_EMAIL`).
2. Start the stack **with** the proxy:

   ```bash
   docker compose --profile tls up -d
   ```

Caddy provisions and auto-renews a Let's Encrypt certificate and proxies to
`app:3000`. See [`caddy/Caddyfile`](caddy/Caddyfile) (incl. a `:80` localhost
fallback and how to enable the ACME e-mail).

---

## Repository layout

```
showtrackr/                   # repo root
├─ docker-compose.yml         # the whole stack (DevOps)
├─ .env.example               # all environment variables (DevOps)
├─ pnpm-workspace.yaml        # pnpm workspace (DevOps)
├─ package.json               # root scripts: dev / build / docker:up / import
├─ .npmrc                     # node-linker=hoisted (Docker-runtime friendly)
├─ caddy/Caddyfile            # reverse proxy config (DevOps)
├─ apps/web/                  # SvelteKit app (Frontend) — incl. apps/web/Dockerfile
├─ packages/db/               # Drizzle schema + migrations (DB)
├─ packages/importer/         # GDPR backfill CLI (Importer) — incl. its Dockerfile
└─ gdpr-data/                 # GDPR export (git-ignored), mounted read-only into `importer`
```

---

## Environment variables

All configuration lives in a single root `.env` (never committed). See
[`.env.example`](.env.example) for the full annotated list:
`DATABASE_URL`, `POSTGRES_*`, `TMDB_API_KEY`, `SESSION_SECRET`, `PUBLIC_BASE_URL`,
`ACME_EMAIL` (optional), `GDPR_DATA_DIR`.

---

## Migrations

The `migrate` service reuses the app image and runs `pnpm run migrate` inside
`packages/db`. That script is expected to be **runtime-safe** — i.e. it applies the
committed SQL migrations using `drizzle-orm`'s migrator (`drizzle-orm/postgres-js/migrator`
or equivalent), **not** `drizzle-kit`, since dev tooling is pruned from the production
image. It must read `DATABASE_URL` and be idempotent.

---

## Common commands

```bash
docker compose up -d --build     # rebuild + (re)start db + app (HTTP)  (npm run docker:up)
docker compose logs -f app       # tail the app logs
docker compose ps                # service status
docker compose --profile import run --rm importer   # run the GDPR import (npm run import)
docker compose --profile tls up -d   # also start the optional Caddy HTTPS proxy
docker compose down              # stop (keeps volumes/data)
docker compose config            # validate the compose file
```

Local (non-Docker) development of the web app:

```bash
pnpm install
pnpm dev                         # -> pnpm --filter ./apps/web dev
```
