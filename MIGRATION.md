# Migrating from TV Time

This guide walks you through moving your history out of **TV Time** and into your
own self-hosted instance. The import runs **inside the app**: you log in and upload
your official GDPR data export, and ShowTrackr reconstructs your **followed shows**,
the **full episode-by-episode watch history** (with real watched-at dates),
**ratings**, **emotions**, **lists**, **movies**, and your **watch-time statistics**
— all into your own account, with a live progress bar.

Your export never leaves your server: it is streamed to a temporary directory,
unpacked, imported, and then deleted.

---

## Overview

```
TV Time  ──(1) request GDPR export──▶  a .zip of CSV files
                                          │
                (2) log in to your instance ──▶ Settings → Import from TV Time
                                          │
                       (3) upload export.zip (TMDB key already set in .env)
                                          │
                     (4) watch the progress bar ──▶ your data, in your app
```

The import is **idempotent**: every write is an upsert on a natural key, so you can
re-run it (upload again) as many times as you like without creating duplicates.

---

## 1. Request your GDPR export from TV Time

Under GDPR (and similar laws) you have the right to a copy of your data. Request it
from TV Time:

- In the **TV Time app**: `Profile → Settings → Account / Privacy → Request my data`
  (wording varies by version), **or**
- By e-mail to TV Time support / privacy (e.g. `support@tvtime.com`), asking for a
  full **GDPR data export** of your account.

The export is delivered as a **`.zip` archive of `.csv` files** and can take a few
days to arrive. Download it and keep it somewhere private — you'll upload it as-is.

> ℹ️ The single most important file inside the zip is **`tracking-prod-records-v2.csv`**
> — it holds the exhaustive, dated, per-episode watch history. Make sure it is present
> in your export; the rest of the reconstruction is best-effort without it.

> You do **not** need to unzip it or place it anywhere on the server — you upload the
> `.zip` directly. Nested sub-folders inside the zip are handled automatically.

---

## 2. Get a free TMDB API key (server admin, one-time)

The import resolves each of your shows against **TMDB** (The Movie Database) to
rebuild the local catalog (posters, seasons, episodes, runtimes). The server needs a
free key configured in `.env`:

1. Create an account at <https://www.themoviedb.org/>.
2. Go to <https://www.themoviedb.org/settings/api> and request an API key.
3. Copy either the **v3 API key** or the **v4 read access token** (auto-detected) and
   set it as `TMDB_API_KEY` in your `.env` (see the [Quick start](README.md#quick-start)).

If the key is missing, the Import page tells you up-front instead of failing midway.

Large uploads also need `BODY_SIZE_LIMIT` set (default ~250MB — see `.env.example`);
the default compose files already wire it into the app service.

---

## 3. Import in the app

1. Bring the stack up if it isn't already:

   ```bash
   docker compose up -d
   ```

2. Open the app (`http://<host-ip>:8080`), **log in** (or create your account), then
   go to **Profile → Import from TV Time** (`/settings/import`).
3. **Choose or drop** your `export.zip` and press **Start import**.
4. Watch the progress bar. The import runs in the background through 7 phases:
   profile & settings → seed followed/watched shows → resolve TMDB & hydrate the
   catalog → rebuild the watch history → rewatches → ratings & emotions →
   lists, comments & movies → recompute statistics. You can leave the page and come
   back; the status is polled from the server.
5. On success you'll see a summary and a link straight to your **library**.

Only **one** import can run per account at a time; starting a second while one is in
flight is rejected. Because the import only ever writes to *your* user id, other
accounts on the same instance are never affected.

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

---

## Advanced: the command-line importer

The same reconstruction pipeline still ships as a standalone CLI in
[`packages/importer`](packages/importer/README.md) (the `showtrackr-import` binary),
which **creates a user** from `user.csv` and imports a local `gdpr-data/` folder. It
is aimed at development / bulk backfill and is no longer part of the Docker compose
stack — the in-app importer above is the supported path for end users.
