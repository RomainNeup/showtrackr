# @showtrackr/importer

GDPR-export backfill CLI for ShowTrackr. Implements the 8-step pipeline from
`PLAN.md` §8: it reads a TV Time GDPR export, resolves each show against TMDB,
hydrates the local catalog, and reconstructs the full episode-by-episode watch
history — then recomputes `user_stats` and prints a validation report.

## Watch source: tracking-v2 is primary (read this first)

The GDPR export **does** contain the exhaustive, dated, per-episode watch history —
it lives in `tracking-prod-records-v2.csv` (a multi-type DynamoDB dump). Rows whose
`key` starts with `watch-episode-` are **3601 individual watched episodes**, each
with `s_id` (TVDB show), `s_no`/`ep_no`, `created_at` (the real watched-at date),
`rewatch_count`, and `runtime` (SECONDS, present on ~1338 of them).

**Step 3 ingests these directly into `episode_watches`** — this is the PRIMARY path:
`first_watched_at = last_watched_at = created_at`, `watch_count = 1 + rewatch_count`.
Every watched episode gets a `catalog_episodes` row (created bare from tracking if
TMDB didn't hydrate it), so the FK always resolves.

### Watermark is a FALLBACK only

The per-show watermark (`show_seen_episode_latest.csv`) is used **only for shows
with ZERO tracking coverage**. It never overwrites tracking data (fallback writes
use `ON CONFLICT DO NOTHING`, and shows already covered by tracking are skipped
entirely — we never "fill gaps" in a tracked show, because tracking is exact).

> **Reconstruction rule (fallback path):** for a show with no tracking rows, mark
> **every episode up to and including the watermark as watched**. Mid-series gaps
> cannot be recovered beyond `seen_episode_source.csv`.

The watermark is resolved to a `(season, episode)` coordinate via: (1) `seen-source`
exact match, (2) TMDB `/find/{tvdbEpisodeId}` → `tv_episode_results`, (3) count-fallback
(first N in air order, `N = nb_episodes_seen`).

## Pipeline steps (PLAN §8)

| Step | What it does | Source files |
|---|---|---|
| 0 | Create the user + settings | `user.csv`, `user_setting.csv` |
| 1 | Seed the **union** of watched/followed shows + follow metadata | `user_tv_show_data.csv`, `followed_tv_show.csv`, `followed_tv_show_source.csv`, `show_seen_episode_latest.csv`, `tracking-prod-records-v2.csv` |
| 2 | Resolve TMDB, hydrate `catalog_shows/seasons/episodes`, write `follows` | TMDB |
| 3 | **Watched history: tracking-v2 PRIMARY, watermark FALLBACK** | `tracking-prod-records-v2.csv` (watch-episode rows), then `show_seen_episode_latest.csv` + `seen_episode_source.csv` + `where-to-watch-prod-table.csv` |
| 4 | Rewatch safety-net (`watch_count → greatest(existing, 1+cpt)`) | `rewatched_episode.csv` |
| 5 | Ratings (clamped 1–5) + emotions per episode | `ratings-*.csv`, `emotions-3-*.csv`, `episode_emotion.csv` |
| 6 | Lists + favorites + comments + **movies** (best-effort) | `lists-prod-lists.csv`, `comments-prod-comments.csv`, `tracking-prod-records.csv` (v1 movies) |
| 7 | Recompute `user_stats`, seed `stats_monthly`, **validation report** | `tracking-prod-records-v2.csv` (`tracking-stats`), `tracking-prod-count-by-timeframe.csv` |

Steps 0–2 build in-memory context (user id, follow metadata, hydrated catalog)
that steps 3–7 depend on, so when you request a single later step with
`--only-step`, steps 0–2 are re-run automatically to rebuild that context.

## Usage

```bash
# Build
pnpm --filter @showtrackr/importer build

# Full backfill (inside the importer container, or locally with env set)
TMDB_API_KEY=... DATABASE_URL=postgres://... showtrackr-import --data-dir /gdpr-data

# Preview without touching the DB (still calls TMDB, prints estimated numbers)
TMDB_API_KEY=... showtrackr-import --dry-run --data-dir ../../gdpr-data

# Re-run one step (idempotent; context steps auto-run)
showtrackr-import --only-step 5
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--dry-run` | off | Read + resolve everything, write nothing. `DATABASE_URL` not required. |
| `--data-dir <path>` | `$GDPR_DATA_DIR` or `/gdpr-data` | GDPR export directory. |
| `--only-step <0-7>` | all | Run a single step (context steps auto-run). |
| `--log-level <lvl>` | `info` | `debug` \| `info` \| `warn` \| `error`. |

### Environment

| Var | Required | Notes |
|---|---|---|
| `TMDB_API_KEY` | yes | v3 api key **or** v4 bearer token (auto-detected). |
| `DATABASE_URL` | yes (unless `--dry-run`) | Postgres 16 connection string. |
| `GDPR_DATA_DIR` | no | Default for `--data-dir`. |

## Idempotency

Every write is a natural-key upsert on the unique constraints declared in
`@showtrackr/db` (`follows(user,show)`, `episode_watches(user,episode)`,
`catalog_episodes(show,season,episode)`, …), so re-running the importer never
duplicates rows. Shows are found-or-created by their TVDB id.

## Validation report

Step 7 recomputes `user_stats`, seeds `stats_monthly`, and compares against the
**authoritative `tracking-stats` aggregate row** of `tracking-prod-records-v2.csv`:

- **Episodes** — `COUNT(episode_watches)` (= COUNT DISTINCT episode, since the table
  is unique per `(user, episode)`) vs `ep_watch_count` (= **3601**). Rewatches add to
  minutes, NOT to the episode count.
- **Series minutes** — `Σ(watch_count × catalog_episodes.runtime_min)` vs
  `total_series_runtime / 60` (= **10 350 000 s ≈ 2875 h**).
- **Movies** — `COUNT(movie_watches)` vs `movie_watch_count` (= **215**).
- **Movie minutes** — `Σ catalog_movies.runtime_min` vs `total_movies_runtime / 60`
  (= **1 472 520 s ≈ 409 h**).
- **Total** — series + movie minutes vs ~**3284 h**.

> `user_statistics.csv` (time_spent = 1745 h, nb_episodes_watched = 3) is a **stale
> cached row** and is deliberately ignored — the `tracking-stats` row is the truth.

`stats_monthly` is seeded from `tracking-prod-count-by-timeframe.csv` (`month-YYYY-M`
rows, normalised to `YYYY-MM`; `episodes = count`, `minutes = runtime/60`). Only the
months TV Time pre-computed are present (partial history) — the frontend recomputes
older months from `episode_watches` dates.

The CLI exits non-zero on a full run when episodes Δ ≥ 2 % or total-minutes Δ ≥ 5 %,
so a bad backfill is visible in CI / `docker compose run`.

## Reconstruction universe (why not just `followed_tv_show`?)

`followed_tv_show.csv` (130 rows) is **not** the set of shows to reconstruct — it
is an incomplete snapshot. The authoritative superset is `user_tv_show_data.csv`
(159 shows), whose per-show `nb_episodes_seen` sums to exactly **3321** (the
control value) and which includes ~19 shows the user watched but no longer
follows (absent from `followed_tv_show.csv`). The importer therefore seeds show
contexts from the **union** of `user_tv_show_data` ∪ `followed_tv_show` ∪ the
watermark file, **deduped by show name** (a show's `tv_show_id` drifts across
files as TheTVDB re-IDs shows). Follows are written for every show flagged
`is_followed` or present in `followed_tv_show`; watched-but-unfollowed shows are
still hydrated and their episodes still counted toward stats. Shows with no
watermark but `nb_episodes_seen > 0` are reconstructed via the count-fallback.

## Known limitations & edge cases

- **Watermark gaps** — see the reconstruction rule above. Skipped mid-series
  episodes are not recoverable.
- **TVDB id drift** — the same show appears under different `tv_show_id`s in
  different files; contexts are keyed by name and every id variant is tried
  against TMDB and mapped back to the show.
- **Failed TMDB resolution** — shows that resolve to no TMDB id get a **stub**
  `catalog_shows` row (sentinel `tmdb_id = -tvdbId`, non-null so the follow and
  counters survive) with **no episodes**. They are listed at the end of the run
  for manual fixup.
- **Rating scale** — app-wide scale is **1–5 stars** (frozen in CONTRACT). Legacy
  export ratings are the trailing integer of `vote_key` (`349352-18235147-3` → `3`),
  clamped to `1..5`. Only value `3` is observed (~3 episodes).
- **Runtime unit** — tracking runtimes are **seconds**; converted to minutes for
  `catalog_episodes.runtime_min`. TMDB runtime is preferred; tracking backfills a
  missing catalog runtime but never overwrites a TMDB one.
- **Movies** — no clean per-title movie *watch* table exists. We recover ~216
  distinct titles from the v1 `tracking-prod-records.csv` (`entity_type = movie`),
  resolve each via TMDB search for real metadata, and create `catalog_movies` +
  `movie_watches`. Unresolved titles get a sentinel `tmdb_id = -hash(title)` (the
  column is NOT NULL + unique) and are listed in the report. The aggregate control
  is 215 movies / 409 h; per-title runtime coverage depends on TMDB matches.
- **Emotions** — two disjoint taxonomies coexist (`episode_emotion.csv`'s
  `emotion_id` column and `emotions-3-*`'s `vote_key` tail). Both are imported;
  `episode_emotions` allows multiple emotions per episode.
- **Favorites** — the export's `is_favorited` column is all-zero; real favorites
  live in the `favorite-series` list, which we fold into `follows.is_favorite`.
- **Comments** — `comments-prod-comments.csv` contains read-markers/entity uuids
  but **no free-text body**, so there is effectively nothing to import. Any
  `body`/`text`/`comment` field is imported defensively if present.
- **Missing runtimes** — episode runtime falls back to the show's average
  (`episode_run_time[0]`); any still-missing runtime counts as 0 minutes and
  shows up as a negative delta in the validation report.
