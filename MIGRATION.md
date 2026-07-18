# Migrating from TV Time

This guide walks you through moving your history out of **TV Time** and into your
own self-hosted instance. The importer reconstructs, from your official GDPR data
export, your **followed shows**, the **full episode-by-episode watch history**
(with real watched-at dates), **ratings**, **emotions**, **lists**, **movies**,
and your **watch-time statistics**.

Everything runs locally. Your export never leaves your machine — the `gdpr-data/`
folder is git-ignored and only mounted **read-only** into the one-shot importer
container.

---

## Overview

```
TV Time  ──(1) request GDPR export──▶  a .zip of CSV files
                                          │
                                (2) unzip into ./gdpr-data/
                                          │
   (3) TMDB key ──▶  (4) docker compose --profile import run --rm importer
                                          │
                            (5) validation report ──▶  your data, in your app
```

The importer is **idempotent**: every write is an upsert on a natural key, so you
can re-run it as many times as you like without creating duplicates.

---

## 1. Request your GDPR export from TV Time

Under GDPR (and similar laws) you have the right to a copy of your data. Request it
from TV Time:

- In the **TV Time app**: `Profile → Settings → Account / Privacy → Request my data`
  (wording varies by version), **or**
- By e-mail to TV Time support / privacy (e.g. `support@tvtime.com`), asking for a
  full **GDPR data export** of your account.

The export is delivered as a **`.zip` archive of `.csv` files** and can take a few
days to arrive. Download it and unzip it somewhere private.

> ℹ️ The single most important file is **`tracking-prod-records-v2.csv`** — it holds
> the exhaustive, dated, per-episode watch history. Make sure it is present in your
> export; the rest of the reconstruction is best-effort without it.

---

## 2. Drop the export into `./gdpr-data/`

Create a `gdpr-data/` folder **at the repo root** and put the unzipped CSVs directly
inside it (flat, not in a nested sub-folder):

```
showtrackr/
└─ gdpr-data/
   ├─ tracking-prod-records-v2.csv        # PRIMARY: full dated watch history
   ├─ user.csv, user_setting.csv          # profile, language, timezone
   ├─ user_tv_show_data.csv               # per-show seen counts / favorites
   ├─ followed_tv_show.csv                # follows + metadata
   ├─ show_seen_episode_latest.csv        # per-show watermark (fallback)
   ├─ seen_episode_source.csv             # explicitly-marked episodes
   ├─ rewatched_episode.csv               # rewatch counts
   ├─ ratings-*.csv                       # episode ratings
   ├─ emotions-3-*.csv, episode_emotion.csv  # per-episode emotions
   ├─ lists-prod-lists.csv                # lists + favorites
   ├─ where-to-watch-prod-table.csv       # platform seen on
   ├─ comments-prod-comments.csv          # comments (usually no free text)
   ├─ tracking-prod-records.csv           # v1 dump (movies)
   └─ tracking-prod-count-by-timeframe.csv   # monthly stats
```

This folder is git-ignored — it will never be committed or pushed.

> Not every export contains every file. The importer skips what is missing and
> reconstructs as much as the available files allow.

---

## 3. Get a free TMDB API key

The importer resolves each of your shows against **TMDB** (The Movie Database) to
rebuild the local catalog (posters, seasons, episodes, runtimes). You need a free
key:

1. Create an account at <https://www.themoviedb.org/>.
2. Go to <https://www.themoviedb.org/settings/api> and request an API key.
3. Copy either the **v3 API key** or the **v4 read access token** — the importer
   auto-detects which one you pasted.

---

## 4. Configure `.env`

If you have not already done the [Quick start](README.md#quick-start):

```bash
cp .env.example .env
```

Then set, at minimum:

| Variable | Value |
|---|---|
| `TMDB_API_KEY` | your TMDB v3 key or v4 token (step 3) |
| `POSTGRES_PASSWORD` | a strong password — `openssl rand -hex 24` |
| `DATABASE_URL` | the same password, e.g. `postgres://showtrackr:<password>@db:5432/showtrackr` |
| `SESSION_SECRET` | `openssl rand -hex 32` |

Bring the stack up so the database exists and migrations are applied:

```bash
docker compose up -d
```

---

## 5. Preview first (dry run — writes nothing)

A dry run reads the export and resolves everything against TMDB but **touches no
data**. It prints the numbers it *would* import, so you can sanity-check coverage
before committing:

```bash
docker compose --profile import run --rm importer node dist/index.js --dry-run
```

`DATABASE_URL` is not required for a dry run.

---

## 6. Run the import

```bash
docker compose --profile import run --rm importer
```

This runs the full 8-step pipeline: create your user → seed followed/watched shows →
resolve TMDB & hydrate the catalog → rebuild the watch history → rewatches →
ratings & emotions → lists, favorites, comments & movies → recompute statistics.

The container mounts `./gdpr-data` read-only at `/gdpr-data` and reads
`DATABASE_URL` and `TMDB_API_KEY` from your `.env`.

Useful flags (append after `node dist/index.js`):

| Flag | Meaning |
|---|---|
| `--dry-run` | read + resolve, write nothing (see step 5) |
| `--only-step <0-7>` | re-run a single step; prerequisite context steps auto-run |
| `--log-level debug` | verbose logging for troubleshooting |
| `--data-dir <path>` | override the export directory (default `/gdpr-data`) |

---

## 7. Read the validation report

The final step recomputes your statistics and compares them against the
authoritative aggregate row inside `tracking-prod-records-v2.csv`, printing a report
(episodes, series minutes, movies, movie minutes, total hours). A full run **exits
non-zero** if episodes drift ≥ 2 % or total minutes drift ≥ 5 %, so a bad backfill
is immediately visible.

Then open the app (`http://<host-ip>:8080`), log in, and your library, history and
stats should be there.

---

## Known limitations

The reconstruction is faithful but a few things cannot be perfectly recovered from
the export. The most important ones:

- **Mid-series gaps** for shows that have no per-episode tracking rows: only a
  watermark ("watched up to S3E7") is available, so skipped earlier episodes cannot
  be distinguished.
- **Movies**: recovered by title from the v1 tracking dump and re-resolved via TMDB;
  titles TMDB cannot match get a placeholder entry.
- **Ratings**: normalised to the app's 1–5 star scale.
- **Comments**: the export generally contains no free-text body, so there is little
  to import.

For the full, technical breakdown of every step, the primary-vs-fallback watch
sources, idempotency guarantees, and every edge case, see
[`packages/importer/README.md`](packages/importer/README.md).
