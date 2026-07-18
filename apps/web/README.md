# @mytvtime/web — SvelteKit app (frontend + API + PWA)

Mobile-first, installable PWA for MyTVTime. SvelteKit (Svelte 5 runes) fullstack
with `@sveltejs/adapter-node`. All data access goes through the shared
`@mytvtime/db` package (Drizzle + Postgres); TMDB is the metadata provider.

## Build & run

```bash
pnpm --filter @mytvtime/db build      # produces dist/ that this app imports
pnpm --filter @mytvtime/web build     # vite build → ./build (adapter-node)
node apps/web/build                   # start (needs env vars below)
```

Type/lint gate: `pnpm --filter @mytvtime/web check` (svelte-check, 0 errors).

### Environment (server-only, read at runtime via `$env/dynamic/private`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (from CONTRACT). |
| `TMDB_API_KEY` | TMDB v3 API key. |
| `SESSION_SECRET` | HMAC key that signs the session cookie. |
| `INSECURE_COOKIES` | Set to `1` only for local HTTP dev (drops the `Secure` flag). |

## Routes map

| Route | File(s) | What it does |
|---|---|---|
| `/` | `+page.server.ts` / `+page.svelte` | **Up Next** — next unwatched, already-aired episode per *watching* show. Mark-watched inline. |
| `/library` | `library/` | Followed-shows grid, status filter chips, favorites section. Actions: `setStatus`, `toggleFavorite`. |
| `/search` | `search/` | Debounced TMDB multi-search (URL `?q=` drives the load). Actions: `open`, `follow`, `openMovie` (cache-through + redirect to local page). |
| `/show/[id]` | `show/[id]/` | Seasons (collapsible) + per-episode watched checkbox + rating. Actions: `toggleEpisode`, `rateEpisode`, `markSeason`, `markAll`, `follow`, `unfollow`, `setStatus`, `toggleFavorite`. `[id]` is the **local catalog id**. |
| `/movie/[id]` | `movie/[id]/` | Mark watched + rate. Actions: `toggleWatched`, `rate`. |
| `/stats` | `stats/` | Viewing **hours**, episodes, movies, shows followed; per-month bars; top shows. Action: `recompute`. |
| `/lists` | `lists/` | Favorite shows + imported custom lists with item counts. |
| `/profile` | `profile/` | User info + totals + sign out. |
| `/login` | `login/` | Sign in; first run (no user) becomes create-account. Actions: `login`, `register`. |
| `/logout` | `logout/+server.ts` | `POST` clears the cookie. |

Navigation is a fixed bottom **TabBar** (`Up Next · Library · Search · Stats ·
Profile`), hidden on `/login`.

## Auth model

Single-user, session-cookie (`src/lib/server/auth.ts`):

- **Passwords**: Node `scrypt`, stored as `scrypt$<saltHex>$<hashHex>` in
  `users.password_hash`; verified with `timingSafeEqual`.
- **Sessions are stateless** (the schema has no `sessions` table): the cookie
  holds an HMAC-SHA256-signed `{uid, exp}` payload keyed by `SESSION_SECRET`.
  Tamper-proof + self-expiring, no server-side store.
- `hooks.server.ts` resolves the cookie into `event.locals.user` and guards
  every route (redirect to `/login` when unauthenticated; away from `/login`
  when authenticated). `redirect()` is thrown control-flow, per SvelteKit.
- **First run**: if `users` is empty, `/login` offers create-account; a second
  self-registration is refused.

## How mutations work

All mutations are **SvelteKit form actions** (`+page.server.ts`) invoked with
progressive-enhancement (`use:enhance`), so they work without JS and update
optimistically with it. Business logic lives in `src/lib/server/library.ts`
(never inline in routes).

- **Mark watched** — `setEpisodeWatched(userId, episodeId, watched)`: toggling
  *on* inserts an `episode_watches` row (`watch_count = 1`, timestamps now) via
  `onConflictDoNothing` (re-marking never resets a rewatch count); toggling
  *off* deletes the row. `markSeasonWatched` / `markShowWatched` bulk-insert all
  episodes of a season / show (hydrating episodes from TMDB first if needed).
  `addRewatch` increments `watch_count`.
- **Rate** — `rateEpisode` / `rateMovie` upsert into `episode_ratings` /
  `movie_ratings`; a rating of `0` clears it. Scale is **5 stars** (see note).
- **Follow** — `followShow` upserts a `follows` row; `setFollowStatus`,
  `setFavorite`, `unfollowShow` manage it.
- **Movies** — `setMovieWatched` inserts/deletes a `movie_watches` row.

Every viewing-time mutation calls `recomputeUserStats(userId)` to invalidate and
rewrite the `user_stats` aggregate.

## Stats

Per CONTRACT:

```
minutes_watched = Σ(episode_watches.watch_count × catalog_episodes.runtime_min)
                + Σ(movie_watches × catalog_movies.runtime_min)
```

`recomputeUserStats` (in `src/lib/server/stats.ts`) computes this with two SQL
aggregate joins + the follow count and upserts `user_stats`. The Stats screen
also derives per-month / per-week buckets (`date_trunc` on `last_watched_at`)
and top shows. Control values from the export: ~3321 episodes / ~1745 h.

## TMDB client (`src/lib/server/tmdb.ts`)

Exactly the CONTRACT surface: `findByTvdbId`, `getShow`, `getSeasonEpisodes`,
`getMovie`, `searchMulti` (TMDB v3, API key from env, 429/5xx backoff). The
**cache-through** helpers in `src/lib/server/catalog.ts` (`ensureShow`,
`ensureSeasonEpisodes`, `ensureMovie`) fetch from TMDB then upsert `catalog_*`,
so repeat views hit Postgres, not the API. Poster/backdrop URLs are built with
the client-safe `src/lib/tmdb-image.ts` (no secret needed).

## PWA

- `static/manifest.webmanifest` — standalone, portrait, theme colors, icons.
- `src/service-worker.ts` — precaches the app shell (`build` + `files`),
  cache-first for hashed assets, network-first for navigations (offline shell).
  Registered manually in `app.html`; SvelteKit's auto-registration is disabled.
- `static/icons/icon.svg` is the real icon; `icon-192.png`, `icon-512.png`,
  `apple-touch-icon.png` are solid-color **placeholders** — replace with a
  rasterized version of the SVG for production polish.

## Assumptions & notes

- `@mytvtime/db` exports a camelCase `schema` barrel + `createDb(url)` returning
  `{ db, client }`. The DB client is created **lazily** (a Proxy) so the build's
  analyse step doesn't fail when env is absent.
- Show/movie routes key off the **local catalog id**, not the TMDB id; Search
  actions cache-through then redirect to that id. **A bare TMDB deep link
  (`/show/<tmdbId>`) will NOT resolve** — enter shows/movies via Search.
- **Rating scale** (frozen in CONTRACT): 1–5 stars app-wide. Writes are clamped
  to `1..5` in `library.ts` (`clampRating`), so the UI, importer, and any stray
  input converge on the same range.
- **Stats semantics** (frozen): `episodes_watched = COUNT(DISTINCT episode)`;
  rewatches (`watch_count > 1`) count toward **minutes only**. Per-month/week
  history is always recomputed from `episode_watches` (the complete source with
  real dates for all episodes); `stats_monthly` is only a partial importer seed
  and is intentionally NOT used here (it would truncate history).
- **Up Next** is a single set-based SQL query (`getUpNext`) — no N+1, and it
  never calls TMDB in the request path (relies on the pre-cached catalog; a
  nightly job refreshes metadata). Specials (season 0) are excluded, matching
  `markShowWatched`.
- **Auth caveats** (single-user, acceptable; noted for future multi-user):
  stateless cookies mean no per-session revocation (rotate `SESSION_SECRET` to
  invalidate all); no login rate-limit. `SESSION_SECRET` must be ≥32 chars
  (asserted at request time). Cookie `Secure` is derived from
  `PUBLIC_BASE_URL`'s scheme (HTTP-first → login works over plain HTTP).
- Service worker caches only the app shell (hashed build assets + static files);
  authenticated page HTML is never cached (no cross-session/logout leak).
- `svelte-check` reports 0 errors.
