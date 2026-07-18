/**
 * The GDPR backfill pipeline (PLAN §8, post-pivot).
 *
 * PRIMARY watch source is `tracking-prod-records-v2.csv` — its `watch-episode` rows
 * are the exhaustive, dated, per-episode history (3601 episodes). Step 3 ingests
 * those directly into `episode_watches`. The per-show *watermark*
 * (`show_seen_episode_latest`) is only a FALLBACK, used for shows with NO tracking
 * coverage; it never overwrites tracking data. See README.md.
 *
 * Idempotency: natural-key upserts everywhere (the same unique keys the DB agent
 * declares in CONTRACT.md), so re-running never duplicates rows.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema, type DbClient } from "./db.js";
import { StepLogger } from "./logger.js";
import { TmdbClient } from "./tmdb.js";
import {
  normName,
  readComments,
  readEpisodeEmotions,
  readEpisodeRatings,
  readFollowSources,
  readFollowedShows,
  readLists,
  readMonthlyStats,
  readRewatchedEpisodes,
  readSeenEpisodeSources,
  readTrackingStats,
  readTrackingWatches,
  readUser,
  readUserSettings,
  readUserTvShowData,
  readV1Movies,
  readWatermarks,
  readWhereToWatch,
} from "./csv.js";

/**
 * Live progress emitted by the pipeline. `step` is a 1-based phase index in
 * [1..TOTAL_STEPS] so the UI can render "step 3/7 · 1240/3601". `processed`/`total`
 * describe progress within the current phase (total may be 0 when unknown/instant).
 */
export interface ImportProgress {
  step: number;
  stepLabel: string;
  processed: number;
  total: number;
  message?: string;
}

/** Number of user-facing phases reported through `onProgress` (denominator of "X/7"). */
export const TOTAL_STEPS = 7;

export type ProgressCallback = (p: ImportProgress) => void | Promise<void>;

export interface PipelineOptions {
  dataDir: string;
  dryRun: boolean;
  onlyStep?: number;
  tmdb: TmdbClient;
  /**
   * When set, the pipeline runs in PER-USER mode: it imports into this EXISTING
   * user id and NEVER creates a user (step 0 only upserts profile fields + settings
   * onto the existing row). When undefined, the legacy CLI behaviour applies (step 0
   * creates/looks-up the user from user.csv).
   */
  userId?: number;
  /** Live progress sink (per-user/app mode). Errors thrown by it are swallowed. */
  onProgress?: ProgressCallback;
}

/** (season, episode) coordinate. */
interface SE {
  season: number;
  episode: number;
}

/** A hydrated catalog episode, keyed in-memory by `${season}-${episode}`. */
interface CatalogEpisode {
  id: number;
  season: number;
  episode: number;
  runtimeMin: number | null;
  airDate: string | null;
}

type FollowStatus = "watching" | "archived" | "stopped" | "upcoming";

interface FollowMeta {
  status: FollowStatus;
  isFavorite: boolean;
  notify: boolean;
  followedAt: Date;
  source: string;
}

interface ShowContext {
  /** Canonical key (normalised name, or `id:<tvdb>` when the name is blank). */
  key: string;
  /** Chosen TVDB id used for TMDB resolution + count-fallback keying. */
  tvdbId: number;
  /** All TVDB ids seen for this show across files (id drift), tried in order for TMDB. */
  tvdbCandidates: number[];
  name: string;
  showId: number;
  tmdbId: number | null;
  runtimeAvg: number | null;
  /** Σ episodes the export says were seen (from user_tv_show_data) — count-fallback + control. */
  nbEpisodesSeen: number;
  follow?: FollowMeta;
  /** `${season}-${episode}` → episode */
  episodes: Map<string, CatalogEpisode>;
  /** episodes sorted by (season, episode), specials (season 0) excluded */
  ordered: CatalogEpisode[];
}

export interface ValidationReport {
  // episodes
  computedEpisodes: number;
  expectedEpisodes: number; // tracking-stats ep_watch_count (= 3601)
  episodeDeltaPct: number;
  // series minutes
  computedSeriesMinutes: number;
  expectedSeriesMinutes: number; // tracking-stats total_series_runtime / 60
  seriesMinuteDeltaPct: number;
  // movies
  computedMovies: number;
  expectedMovies: number; // tracking-stats movie_watch_count (= 215)
  computedMovieMinutes: number;
  expectedMovieMinutes: number; // tracking-stats total_movies_runtime / 60
  // totals
  computedTotalMinutes: number;
  expectedTotalMinutes: number;
  totalMinuteDeltaPct: number;
  // provenance
  trackedEpisodes: number; // from tracking-v2 (primary)
  fallbackEpisodes: number; // from watermark reconstruction (fallback)
  monthsSeeded: number;
  showsFollowed: number;
  showsResolved: number;
  showsFailed: string[];
  moviesFailed: string[];
}

const epKey = (s: number, e: number) => `${s}-${e}`;

export class Pipeline {
  private readonly db: DbClient;
  private readonly dryRun: boolean;
  private readonly dataDir: string;
  private readonly tmdb: TmdbClient;
  private readonly onProgress?: ProgressCallback;
  /** True when a userId was supplied → import into an existing account, never create one. */
  private readonly perUser: boolean;
  private readonly presetUserId: number;

  private userId = 0;
  private fakeId = -1; // negative synthetic ids used only in dry-run
  private readonly shows = new Map<string, ShowContext>(); // canonicalKey → context
  private readonly keyByTvdb = new Map<number, string>(); // any tvdb id → canonicalKey
  private readonly nameToKey = new Map<string, string>(); // normalised name → canonicalKey
  private readonly failedShows: string[] = [];
  private readonly moviesFailed: string[] = [];
  /** ctx.key of shows that received at least one watch from tracking-v2 (primary). */
  private readonly coveredByTracking = new Set<string>();
  private trackedEpisodes = 0;
  private fallbackEpisodes = 0;
  private monthsSeeded = 0;
  private readonly watermarkResolution: Record<string, number> = {
    "seen-source": 0,
    "tmdb-find": 0,
    "count-fallback": 0,
    unresolved: 0,
  };

  constructor(db: DbClient, opts: PipelineOptions) {
    this.db = db;
    this.dryRun = opts.dryRun;
    this.dataDir = opts.dataDir;
    this.tmdb = opts.tmdb;
    this.onProgress = opts.onProgress;
    this.perUser = opts.userId !== undefined;
    this.presetUserId = opts.userId ?? 0;
  }

  private next(): number {
    return this.fakeId--;
  }

  /** Report progress to the optional sink; never let a sink error break the import. */
  private async emit(step: number, stepLabel: string, processed: number, total: number, message?: string): Promise<void> {
    if (!this.onProgress) return;
    try {
      await this.onProgress({ step, stepLabel, processed, total, message });
    } catch {
      // A failing progress sink (e.g. a DB hiccup writing import_jobs) must never
      // abort the reconstruction itself.
    }
  }

  /**
   * Resolve a show context by TVDB id, falling back to a name match.
   * Shows carry different tv_show_ids across files (TheTVDB re-IDs over time), so
   * contexts are keyed by name; both an id-index and a name-index point at them.
   */
  private resolveShowCtx(tvdbId: number | undefined, name: string | undefined): ShowContext | undefined {
    if (tvdbId !== undefined) {
      const key = this.keyByTvdb.get(tvdbId);
      if (key) return this.shows.get(key);
    }
    const nameKey = this.nameToKey.get(normName(name));
    return nameKey ? this.shows.get(nameKey) : undefined;
  }

  /** Find-or-create a context, merging data seen for the same show across files. */
  private upsertContext(tvdbId: number | undefined, name: string | undefined): ShowContext {
    const nn = normName(name);
    const key = nn.length > 0 ? `n:${nn}` : `i:${tvdbId ?? "?"}`;
    let ctx = this.shows.get(key);
    if (!ctx) {
      ctx = {
        key,
        tvdbId: tvdbId ?? 0,
        tvdbCandidates: [],
        name: name ?? "",
        showId: 0,
        tmdbId: null,
        runtimeAvg: null,
        nbEpisodesSeen: 0,
        episodes: new Map(),
        ordered: [],
      };
      this.shows.set(key, ctx);
      if (nn.length > 0) this.nameToKey.set(nn, key);
    }
    if (tvdbId !== undefined && Number.isFinite(tvdbId)) {
      if (!ctx.tvdbCandidates.includes(tvdbId)) ctx.tvdbCandidates.push(tvdbId);
      if (ctx.tvdbId === 0) ctx.tvdbId = tvdbId;
      this.keyByTvdb.set(tvdbId, key);
    }
    return ctx;
  }

  private shouldRun(step: number, only?: number): boolean {
    return only === undefined || only === step;
  }

  async run(only?: number): Promise<ValidationReport> {
    // Steps 0/1/2 populate in-memory context needed by later steps, so when a
    // single later step is requested we still run the cheap context-building
    // parts (user + follows + catalog) unless the requested step is <= that.
    const needContext = only === undefined || only >= 3;

    if (this.perUser) {
      // App / per-user mode: import into the supplied existing account. `only` is
      // never used here (the app always runs the full pipeline).
      this.userId = this.presetUserId;
      await this.step0ProfileExisting();
    } else if (this.shouldRun(0, only)) {
      await this.step0User();
    } else if (needContext) {
      await this.resolveUserId();
    }

    if (this.shouldRun(1, only) || needContext) await this.step1Follows(only);
    if (this.shouldRun(2, only) || needContext) await this.step2Catalog();
    if (this.shouldRun(3, only)) await this.step3Watched();
    if (this.shouldRun(4, only)) await this.step4Rewatches();
    if (this.shouldRun(5, only)) await this.step5RatingsEmotions();
    if (this.shouldRun(6, only)) await this.step6ListsComments();

    // Step 7 always runs last (recompute + validation) unless a different single step was requested.
    return await this.step7Stats(only);
  }

  // ── Step 0: user + settings ────────────────────────────────────────────────
  private async step0User(): Promise<void> {
    const log = new StepLogger(0);
    const done = log.begin("User & settings");
    const user = readUser(this.dataDir);
    if (!user) {
      log.error("user.csv missing or empty — cannot create user");
      throw new Error("user.csv is required");
    }
    log.info("Importing user", { name: user.name, email: user.email, tz: user.timezone });

    if (this.dryRun) {
      this.userId = this.next();
    } else {
      const [row] = await this.db
        .insert(schema.users)
        .values({
          email: user.email ?? `user-${user.id}@local`,
          passwordHash: user.passwordHash ?? "",
          displayName: user.name ?? "me",
          timezone: user.timezone ?? "Europe/Paris",
          language: user.language ?? "en",
          createdAt: user.createdAt ?? new Date(),
        })
        .onConflictDoUpdate({
          target: schema.users.email,
          set: {
            displayName: user.name ?? "me",
            timezone: user.timezone ?? "Europe/Paris",
            language: user.language ?? "en",
          },
        })
        .returning({ id: schema.users.id });
      this.userId = row!.id;
    }

    const settings = readUserSettings(this.dataDir);
    log.info(`Importing ${settings.length} settings`);
    if (!this.dryRun) {
      for (const s of settings) {
        await this.db
          .insert(schema.settings)
          .values({ userId: this.userId, key: s.key, value: s.value ?? "" })
          .onConflictDoUpdate({
            target: [schema.settings.userId, schema.settings.key],
            set: { value: s.value ?? "" },
          });
      }
    }
    done();
  }

  /** When step 0 is skipped but later steps run, we still need the user id. */
  private async resolveUserId(): Promise<void> {
    if (this.userId !== 0) return;
    const user = readUser(this.dataDir);
    if (this.dryRun || !user) {
      this.userId = this.next();
      return;
    }
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, user.email ?? `user-${user.id}@local`))
      .limit(1);
    this.userId = rows[0]?.id ?? this.next();
  }

  /**
   * Per-user (app) variant of step 0: the account ALREADY exists (created by
   * registration), so we NEVER insert a user or change its id/email. We only
   * upsert the profile *preferences* (display name, timezone, language) from
   * user.csv onto this user's own row, plus the user's own settings. All writes
   * are scoped to `this.userId`; no other user is ever read or modified.
   */
  private async step0ProfileExisting(): Promise<void> {
    const log = new StepLogger(0);
    const done = log.begin("Profile & settings (existing account)");
    await this.emit(1, "Profile & settings", 0, 1);
    const user = readUser(this.dataDir);
    if (user && !this.dryRun) {
      const set: Partial<{ displayName: string; timezone: string; language: string }> = {};
      if (user.name) set.displayName = user.name;
      if (user.timezone) set.timezone = user.timezone;
      if (user.language) set.language = user.language;
      // Never touch email (identity/unique key) or id. Only preferences.
      if (Object.keys(set).length > 0) {
        await this.db.update(schema.users).set(set).where(eq(schema.users.id, this.userId));
      }
    }

    const settings = readUserSettings(this.dataDir);
    if (!this.dryRun) {
      for (const s of settings) {
        await this.db
          .insert(schema.settings)
          .values({ userId: this.userId, key: s.key, value: s.value ?? "" })
          .onConflictDoUpdate({
            target: [schema.settings.userId, schema.settings.key],
            set: { value: s.value ?? "" },
          });
      }
    }
    log.info(`Updated profile + ${settings.length} settings for existing user ${this.userId}`);
    await this.emit(1, "Profile & settings", 1, 1);
    done();
  }

  // ── Step 1: seed show contexts (union) + follow metadata ────────────────────
  private async step1Follows(only?: number): Promise<void> {
    const log = new StepLogger(1);
    const done = log.begin("Show contexts & follows");
    const followed = readFollowedShows(this.dataDir);
    const sources = readFollowSources(this.dataDir);
    const userData = readUserTvShowData(this.dataDir);
    const watermarks = readWatermarks(this.dataDir);

    // The show universe is the UNION of everything the export watched or followed —
    // NOT just followed_tv_show. `user_tv_show_data` carries per-show nb_episodes_seen
    // (used only for the watermark count-fallback) and includes watched-but-unfollowed
    // shows; tracking-v2 (seeded below) adds any show that only appears in the watch
    // history. We dedupe by name because a show's tv_show_id drifts across files.
    // (Authoritative watch totals come from tracking-stats, not these counters.)

    // (a) user_tv_show_data: authoritative counters + is_favorited + is_followed
    for (const u of userData) {
      const ctx = this.upsertContext(u.tvdbId, u.tvShowName);
      ctx.nbEpisodesSeen = Math.max(ctx.nbEpisodesSeen, u.nbEpisodesSeen);
      // A show watched enough to have a counter and flagged followed here gets a
      // follow even if it is missing from followed_tv_show.csv.
      if (u.isFollowed && !ctx.follow) {
        ctx.follow = {
          status: "watching",
          isFavorite: u.isFavorited,
          notify: true,
          followedAt: new Date(),
          source: "gdpr-import",
        };
      }
      if (ctx.follow && u.isFavorited) ctx.follow.isFavorite = true;
    }

    // (b) followed_tv_show: authoritative follow metadata (status/notify/date/source)
    for (const f of followed) {
      const ctx = this.upsertContext(f.tvdbId, f.tvShowName);
      ctx.follow = {
        status: f.archived ? "archived" : "watching",
        isFavorite: ctx.follow?.isFavorite ?? false,
        notify: (f.notificationType ?? 0) > 0,
        followedAt: f.createdAt ?? ctx.follow?.followedAt ?? new Date(),
        source: sources.get(f.tvdbId) ?? "gdpr-import",
      };
    }

    // (c) watermarks: make sure every watched show has a context (id may be new)
    for (const w of watermarks) this.upsertContext(w.tvdbId, w.tvShowName);

    // (d) tracking-v2 watch rows: the primary source references shows by s_id +
    // series_name; seed any show that appears only there (watched, maybe unfollowed).
    for (const t of readTrackingWatches(this.dataDir)) this.upsertContext(t.showTvdbId, t.seriesName);

    const withFollow = [...this.shows.values()].filter((c) => c.follow).length;
    log.info(
      `${this.shows.size} distinct shows (union): ${withFollow} to follow, ` +
        `${followed.length} in followed_tv_show, ${userData.length} in user_tv_show_data`,
    );

    if (only === 1) {
      log.warn("Running step 1 alone does not write follow rows (FK needs catalog); run step 2 too.");
    }
    await this.emit(1, "Seeding shows & follows", this.shows.size, this.shows.size);
    done();
  }

  // ── Step 2: TMDB resolution + catalog hydration (+ write follows) ───────────
  private async step2Catalog(): Promise<void> {
    const log = new StepLogger(2);
    const done = log.begin("TMDB resolution & catalog hydration");
    let resolved = 0;
    const totalShows = this.shows.size;
    let processedShows = 0;
    await this.emit(2, "Resolving catalog (TMDB)", 0, totalShows);

    for (const ctx of this.shows.values()) {
      processedShows++;
      await this.emit(2, "Resolving catalog (TMDB)", processedShows, totalShows, ctx.name);
      // 1. resolve TMDB id — try each drifted TVDB id, then fall back to name search.
      let tmdbId: number | null = null;
      for (const candidate of ctx.tvdbCandidates.length ? ctx.tvdbCandidates : [ctx.tvdbId]) {
        const find = await this.tmdb.findByTvdbId(candidate);
        if (find) {
          tmdbId = find.tmdbId;
          ctx.tvdbId = candidate; // remember which id actually resolved
          break;
        }
      }
      if (tmdbId === null) {
        const search = await this.tmdb.searchShow(ctx.name);
        if (search) {
          tmdbId = search.tmdbId;
          log.warn("Resolved by name search (tvdb find failed)", { show: ctx.name, tvdbId: ctx.tvdbId });
        }
      }

      if (tmdbId === null) {
        this.failedShows.push(`${ctx.name} (tvdb:${ctx.tvdbId})`);
        log.error("TMDB resolution FAILED — inserting stub show, no episodes", {
          show: ctx.name,
          tvdbId: ctx.tvdbId,
        });
        ctx.showId = await this.findOrCreateShow(ctx, null, null);
        await this.writeFollow(ctx);
        continue;
      }

      ctx.tmdbId = tmdbId;
      const show = await this.tmdb.getShow(tmdbId);
      if (!show) {
        this.failedShows.push(`${ctx.name} (tvdb:${ctx.tvdbId}, tmdb:${tmdbId} details missing)`);
        ctx.showId = await this.findOrCreateShow(ctx, tmdbId, null);
        await this.writeFollow(ctx);
        continue;
      }

      ctx.runtimeAvg = show.episode_run_time?.[0] ?? null;
      ctx.showId = await this.findOrCreateShow(ctx, tmdbId, show);

      // 2. hydrate seasons/episodes
      const seasons = show.seasons ?? [];
      for (const season of seasons) {
        const s = await this.tmdb.getSeasonEpisodes(tmdbId, season.season_number);
        if (!s) continue;
        await this.upsertSeason(ctx.showId, season.season_number, season.name ?? s.name, s.episodes.length);
        for (const ep of s.episodes) {
          const runtime = ep.runtime ?? ctx.runtimeAvg ?? null;
          const episodeId = await this.upsertEpisode(ctx.showId, ep, runtime);
          const cat: CatalogEpisode = {
            id: episodeId,
            season: ep.season_number,
            episode: ep.episode_number,
            runtimeMin: runtime,
            airDate: ep.air_date ?? null,
          };
          ctx.episodes.set(epKey(ep.season_number, ep.episode_number), cat);
        }
      }
      ctx.ordered = [...ctx.episodes.values()]
        .filter((e) => e.season >= 1)
        .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

      resolved++;
      await this.writeFollow(ctx);
      log.info("Hydrated", { show: ctx.name, tmdbId, episodes: ctx.ordered.length });
    }

    log.info(`Catalog hydration complete: ${resolved}/${this.shows.size} resolved, ${this.failedShows.length} failed`);
    done();
  }

  private async writeFollow(ctx: ShowContext): Promise<void> {
    const follow = ctx.follow;
    if (!follow || this.dryRun) return;
    await this.db
      .insert(schema.follows)
      .values({
        userId: this.userId,
        showId: ctx.showId,
        status: follow.status,
        isFavorite: follow.isFavorite,
        notify: follow.notify,
        followedAt: follow.followedAt,
        source: follow.source,
      })
      .onConflictDoUpdate({
        target: [schema.follows.userId, schema.follows.showId],
        set: {
          status: follow.status,
          isFavorite: follow.isFavorite,
          notify: follow.notify,
          source: follow.source,
        },
      });
  }

  private async findOrCreateShow(
    ctx: ShowContext,
    tmdbId: number | null,
    show: import("./tmdb.js").TmdbShow | null,
  ): Promise<number> {
    if (this.dryRun) return this.next();
    // catalog_shows.tmdb_id is NOT NULL + UNIQUE. Unresolved shows still need a row
    // (so the follow + counters survive), so we use a negative sentinel = -tvdbId:
    // deterministic, unique, non-null, and obviously-not-a-real-tmdb-id.
    const values = {
      tmdbId: tmdbId ?? -ctx.tvdbId,
      tvdbId: ctx.tvdbId,
      name: show?.name ?? ctx.name,
      posterPath: show?.poster_path ?? null,
      backdropPath: show?.backdrop_path ?? null,
      overview: show?.overview ?? null,
      status: show?.status ?? null,
      firstAirDate: show?.first_air_date || null,
      network: show?.networks?.[0]?.name ?? null,
      runtimeAvgMin: show?.episode_run_time?.[0] ?? null,
    };
    // Natural key from the export is the tvdb id (tmdb may be null for stubs), so
    // find-or-create on tvdb_id keeps re-runs idempotent even without a tmdb id.
    const existing = await this.db
      .select({ id: schema.catalogShows.id })
      .from(schema.catalogShows)
      .where(eq(schema.catalogShows.tvdbId, ctx.tvdbId))
      .limit(1);
    if (existing[0]) {
      await this.db.update(schema.catalogShows).set(values).where(eq(schema.catalogShows.id, existing[0].id));
      return existing[0].id;
    }
    const [row] = await this.db.insert(schema.catalogShows).values(values).returning({ id: schema.catalogShows.id });
    return row!.id;
  }

  private async upsertSeason(
    showId: number,
    seasonNumber: number,
    name: string | undefined,
    episodeCount: number,
  ): Promise<void> {
    if (this.dryRun) return;
    await this.db
      .insert(schema.catalogSeasons)
      .values({ showId, seasonNumber, name: name ?? `Season ${seasonNumber}`, episodeCount })
      .onConflictDoUpdate({
        target: [schema.catalogSeasons.showId, schema.catalogSeasons.seasonNumber],
        set: { name: name ?? `Season ${seasonNumber}`, episodeCount },
      });
  }

  private async upsertEpisode(
    showId: number,
    ep: import("./tmdb.js").TmdbEpisode,
    runtime: number | null,
  ): Promise<number> {
    if (this.dryRun) return this.next();
    const values = {
      showId,
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
      name: ep.name ?? null,
      airDate: ep.air_date || null,
      runtimeMin: runtime,
      tmdbId: ep.id,
      tvdbEpisodeId: null as number | null,
    };
    const [row] = await this.db
      .insert(schema.catalogEpisodes)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.catalogEpisodes.showId,
          schema.catalogEpisodes.seasonNumber,
          schema.catalogEpisodes.episodeNumber,
        ],
        set: { name: values.name, airDate: values.airDate, runtimeMin: runtime, tmdbId: ep.id },
      })
      .returning({ id: schema.catalogEpisodes.id });
    return row!.id;
  }

  /**
   * Ensure a catalog_episodes row exists for (ctx, season, episode) and return its id.
   * Tracking references episodes that TMDB may not have hydrated (or the show failed
   * TMDB entirely); we create a bare row so the watch has a valid FK target. Runtime
   * from tracking backfills a missing catalog runtime but never overwrites TMDB's.
   */
  private async ensureEpisode(
    ctx: ShowContext,
    season: number,
    episode: number,
    runtimeMinFromTracking: number | null,
  ): Promise<number> {
    const key = epKey(season, episode);
    const existing = ctx.episodes.get(key);
    if (existing) {
      if (existing.runtimeMin == null && runtimeMinFromTracking != null) {
        existing.runtimeMin = runtimeMinFromTracking;
        if (!this.dryRun) {
          await this.db
            .update(schema.catalogEpisodes)
            .set({ runtimeMin: runtimeMinFromTracking })
            .where(eq(schema.catalogEpisodes.id, existing.id));
        }
      }
      return existing.id;
    }
    const runtime = runtimeMinFromTracking ?? ctx.runtimeAvg ?? null;
    let id: number;
    if (this.dryRun) {
      id = this.next();
    } else {
      const [row] = await this.db
        .insert(schema.catalogEpisodes)
        .values({ showId: ctx.showId, seasonNumber: season, episodeNumber: episode, runtimeMin: runtime })
        .onConflictDoUpdate({
          target: [
            schema.catalogEpisodes.showId,
            schema.catalogEpisodes.seasonNumber,
            schema.catalogEpisodes.episodeNumber,
          ],
          // fill runtime only if currently null (never clobber a TMDB runtime)
          set: { runtimeMin: sql`coalesce(${schema.catalogEpisodes.runtimeMin}, ${runtime})` },
        })
        .returning({ id: schema.catalogEpisodes.id });
      id = row!.id;
    }
    const cat: CatalogEpisode = { id, season, episode, runtimeMin: runtime, airDate: null };
    ctx.episodes.set(key, cat);
    return id;
  }

  // ── Step 3: watched history — tracking-v2 PRIMARY, watermark FALLBACK ────────
  private async step3Watched(): Promise<void> {
    const log = new StepLogger(3);
    const done = log.begin("Watched history (tracking primary + watermark fallback)");

    // Platform-per-episode (Netflix, …) from where-to-watch — needed by BOTH the
    // primary and fallback paths, so build it up-front (m2: it used to live in 3b
    // only, which never fired, so no platform was ever imported).
    const platformBySE = new Map<string, string>();
    for (const w of readWhereToWatch(this.dataDir)) {
      if (w.seriesName && w.seasonNumber !== undefined && w.episodeNumber !== undefined && w.platform) {
        platformBySE.set(`${normName(w.seriesName)}|${w.seasonNumber}|${w.episodeNumber}`, w.platform);
      }
    }

    // ---- 3a. PRIMARY: the exhaustive per-episode history from tracking-v2 ----
    const watches = readTrackingWatches(this.dataDir);
    let missingCtx = 0;
    let processedWatches = 0;
    await this.emit(3, "Rebuilding watch history", 0, watches.length);
    for (const w of watches) {
      processedWatches++;
      // Throttle emits: one every 25 rows is plenty for a smooth bar over 3601 rows.
      if (processedWatches % 25 === 0) {
        await this.emit(3, "Rebuilding watch history", processedWatches, watches.length);
      }
      const ctx = this.resolveShowCtx(w.showTvdbId, w.seriesName);
      if (!ctx || !ctx.showId) {
        missingCtx++;
        continue;
      }
      const runtimeMin = w.runtimeSec && w.runtimeSec > 0 ? Math.round(w.runtimeSec / 60) : null;
      const epId = await this.ensureEpisode(ctx, w.seasonNumber, w.episodeNumber, runtimeMin);
      const at = w.watchedAt ?? new Date();
      const platform = platformBySE.get(`${normName(ctx.name)}|${w.seasonNumber}|${w.episodeNumber}`) ?? null;
      await this.upsertWatch(epId, 1 + w.rewatchCount, at, at, platform, { overrideCount: true });
      this.coveredByTracking.add(ctx.key);
      this.trackedEpisodes++;
    }
    log.info(`Tracking: ingested ${this.trackedEpisodes} episode-watches across ${this.coveredByTracking.size} shows`, {
      missingCtx,
    });

    // ---- 3b. FALLBACK: watermark reconstruction for shows with ZERO tracking ----
    const watermarks = readWatermarks(this.dataDir);
    const seenSources = readSeenEpisodeSources(this.dataDir);
    const wmByKey = new Map<string, import("./csv.js").Watermark>();
    for (const wm of watermarks) {
      const ctx = this.resolveShowCtx(wm.tvdbId, wm.tvShowName);
      if (ctx) wmByKey.set(ctx.key, wm);
    }
    const seenDateBySE = new Map<string, Date>();
    const seByEpisodeTvdb = new Map<number, SE>();
    for (const s of seenSources) {
      const k = `${normName(s.tvShowName)}|${s.seasonNumber}|${s.episodeNumber}`;
      if (s.createdAt) seenDateBySE.set(k, s.createdAt);
      seByEpisodeTvdb.set(s.episodeTvdbId, { season: s.seasonNumber, episode: s.episodeNumber });
    }

    for (const ctx of this.shows.values()) {
      if (this.coveredByTracking.has(ctx.key)) continue; // tracking is authoritative — never fill gaps
      const wm = wmByKey.get(ctx.key);
      if (!wm && ctx.nbEpisodesSeen === 0) continue; // genuinely nothing watched
      if (ctx.ordered.length === 0) {
        log.warn("No hydrated episodes & no tracking — cannot reconstruct", { show: ctx.name });
        this.watermarkResolution.unresolved = (this.watermarkResolution.unresolved ?? 0) + 1;
        continue;
      }
      let se: SE | null = null;
      let method: string;
      if (wm) ({ se, method } = await this.resolveWatermark(wm, ctx, seByEpisodeTvdb));
      else method = "count-fallback";
      this.watermarkResolution[method] = (this.watermarkResolution[method] ?? 0) + 1;

      const toMark: CatalogEpisode[] = se
        ? ctx.ordered.filter((e) => e.season < se!.season || (e.season === se!.season && e.episode <= se!.episode))
        : ctx.ordered.slice(0, ctx.nbEpisodesSeen || ctx.ordered.length);

      const wmDate = wm?.createdAt ?? wm?.updatedAt ?? new Date();
      for (const ep of toMark) {
        const seKey = `${normName(ctx.name)}|${ep.season}|${ep.episode}`;
        const watchedAt = seenDateBySE.get(seKey) ?? wmDate;
        const platform = platformBySE.get(seKey) ?? null;
        // insert-only: fallback must NEVER overwrite anything already present.
        await this.upsertWatch(ep.id, 1, watchedAt, watchedAt, platform, { insertOnly: true });
        this.fallbackEpisodes++;
      }
      log.debug("Fallback-marked", { show: ctx.name, count: toMark.length, method });
    }

    log.info(
      `Watched history: ${this.trackedEpisodes} from tracking + ${this.fallbackEpisodes} from watermark fallback`,
      this.watermarkResolution,
    );
    await this.emit(3, "Rebuilding watch history", watches.length, watches.length);
    done();
  }

  private async resolveWatermark(
    wm: import("./csv.js").Watermark,
    ctx: ShowContext,
    seByEpisodeTvdb: Map<number, SE>,
  ): Promise<{ se: SE | null; method: string }> {
    // 1. Authoritative from the export itself (seen_episode_source has both id and S/E).
    const fromSource = seByEpisodeTvdb.get(wm.episodeTvdbId);
    if (fromSource && ctx.episodes.has(epKey(fromSource.season, fromSource.episode))) {
      return { se: fromSource, method: "seen-source" };
    }
    // 2. TMDB find by tvdb episode id → (season, episode).
    const found = await this.tmdb.findEpisodeByTvdbId(wm.episodeTvdbId);
    if (found && ctx.episodes.has(epKey(found.seasonNumber, found.episodeNumber))) {
      return { se: { season: found.seasonNumber, episode: found.episodeNumber }, method: "tmdb-find" };
    }
    // 3. Give up on exact coordinate → caller uses nb_episodes_seen count fallback.
    return { se: null, method: "count-fallback" };
  }

  private async upsertWatch(
    episodeId: number,
    watchCount: number,
    firstWatchedAt: Date,
    lastWatchedAt: Date,
    platform: string | null,
    opts: { overrideCount?: boolean; insertOnly?: boolean; maxCount?: boolean } = {},
  ): Promise<void> {
    if (this.dryRun) return;
    const values = { userId: this.userId, episodeId, watchCount, firstWatchedAt, lastWatchedAt, platform };
    const target = [schema.episodeWatches.userId, schema.episodeWatches.episodeId];
    // insertOnly → fallback path: never touch an existing (tracking) row.
    if (opts.insertOnly) {
      await this.db.insert(schema.episodeWatches).values(values).onConflictDoNothing({ target });
      return;
    }
    const set: Record<string, unknown> = { lastWatchedAt };
    // Only overwrite platform when we actually have one, so a later overlay that
    // carries no platform doesn't null a platform set earlier (where-to-watch).
    if (platform !== null) set.platform = platform;
    if (opts.maxCount) {
      // Secondary overlay (rewatched_episode): the count can only grow, and the date
      // can only move forward — a stale legacy created_at must not drag it backwards.
      // Reference the excluded (to-be-inserted) row rather than re-interpolating the
      // raw JS values: drizzle only applies the column's timestamptz mapper on the
      // .values() path, so a raw Date in a sql`` fragment reaches postgres.js
      // unserialised and throws. `excluded.*` is already correctly typed.
      set.watchCount = sql`greatest(${schema.episodeWatches.watchCount}, excluded.watch_count)`;
      set.lastWatchedAt = sql`greatest(${schema.episodeWatches.lastWatchedAt}, excluded.last_watched_at)`;
    } else if (opts.overrideCount) {
      set.watchCount = watchCount;
    }
    await this.db.insert(schema.episodeWatches).values(values).onConflictDoUpdate({ target, set });
  }

  // ── Step 4: rewatches (SECONDARY — tracking rewatch_count already applied) ──
  private async step4Rewatches(): Promise<void> {
    const log = new StepLogger(4);
    const done = log.begin("Rewatches (rewatched_episode.csv safety net)");
    // tracking-v2 already set watch_count = 1 + rewatch_count in step 3. This legacy
    // file is a safety net: bump watch_count to GREATEST(existing, 1+cpt) so it can
    // only ever increase a count, never lower a tracking-derived one.
    const rewatches = readRewatchedEpisodes(this.dataDir);
    let applied = 0;
    let missing = 0;
    await this.emit(4, "Applying rewatches", 0, rewatches.length);
    for (const rw of rewatches) {
      const ctx = this.resolveShowCtx(undefined, rw.tvShowName);
      if (!ctx || !ctx.showId) {
        missing++;
        continue;
      }
      const epId = await this.ensureEpisode(ctx, rw.seasonNumber, rw.episodeNumber, null);
      const at = rw.createdAt ?? new Date();
      await this.upsertWatch(epId, 1 + rw.cpt, at, at, null, { maxCount: true });
      applied++;
    }
    log.info(`Applied ${applied} rewatches (watch_count → greatest(existing, 1+cpt)), ${missing} unresolved`);
    await this.emit(4, "Applying rewatches", rewatches.length, rewatches.length);
    done();
  }

  // ── Step 5: ratings + emotions ───────────────────────────────────────────────
  private async step5RatingsEmotions(): Promise<void> {
    const log = new StepLogger(5);
    const done = log.begin("Ratings & emotions");
    const ratings = readEpisodeRatings(this.dataDir);
    const emotions = readEpisodeEmotions(this.dataDir);
    const total5 = ratings.length + emotions.length;
    await this.emit(5, "Ratings & emotions", 0, total5);

    let ratingsApplied = 0;
    for (const r of ratings) {
      const ep = this.findEpisode(r.seriesName, r.seasonNumber, r.episodeNumber);
      if (!ep || r.voteValue === undefined) continue;
      // App-wide scale is 1–5 stars (CONTRACT, FROZEN) → clamp.
      const rating = Math.max(1, Math.min(5, r.voteValue));
      if (!this.dryRun) {
        await this.db
          .insert(schema.episodeRatings)
          .values({ userId: this.userId, episodeId: ep.id, rating })
          .onConflictDoUpdate({
            target: [schema.episodeRatings.userId, schema.episodeRatings.episodeId],
            set: { rating },
          });
      }
      ratingsApplied++;
    }

    let emotionsApplied = 0;
    const seen = new Set<string>();
    for (const em of emotions) {
      const ep = this.findEpisode(em.tvShowName, em.seasonNumber, em.episodeNumber);
      if (!ep) continue;
      const dedup = `${ep.id}-${em.emotionId}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      if (!this.dryRun) {
        await this.db
          .insert(schema.episodeEmotions)
          .values({ userId: this.userId, episodeId: ep.id, emotionId: em.emotionId })
          .onConflictDoNothing({
            target: [
              schema.episodeEmotions.userId,
              schema.episodeEmotions.episodeId,
              schema.episodeEmotions.emotionId,
            ],
          });
      }
      emotionsApplied++;
    }

    log.info(`Applied ${ratingsApplied} ratings (clamped 1..5), ${emotionsApplied} emotions`);
    await this.emit(5, "Ratings & emotions", total5, total5);
    done();
  }

  private findEpisode(
    seriesName: string | undefined,
    season: number | undefined,
    episode: number | undefined,
  ): CatalogEpisode | undefined {
    if (season === undefined || episode === undefined) return undefined;
    return this.resolveShowCtx(undefined, seriesName)?.episodes.get(epKey(season, episode));
  }

  // ── Step 6: lists + comments ─────────────────────────────────────────────────
  private async step6ListsComments(): Promise<void> {
    const log = new StepLogger(6);
    const done = log.begin("Lists & comments");
    await this.emit(6, "Lists, comments & movies", 0, 0);
    const lists = readLists(this.dataDir);
    const showIdByTvdb = new Map<number, number>();
    for (const ctx of this.shows.values()) {
      if (!ctx.showId) continue;
      for (const t of ctx.tvdbCandidates) showIdByTvdb.set(t, ctx.showId);
    }

    let listCount = 0;
    let itemCount = 0;
    const favoriteShowIds = new Set<number>();

    for (const l of lists) {
      const name = l.name ?? l.slug ?? "list";
      const slug = l.slug ?? normName(name).replace(/\s+/g, "-");
      let listId: number;
      if (this.dryRun) {
        listId = this.next();
      } else {
        // find-or-create by (user, slug) — slug isn't declared unique so do it by hand.
        const existing = await this.db
          .select({ id: schema.lists.id })
          .from(schema.lists)
          .where(and(eq(schema.lists.userId, this.userId), eq(schema.lists.slug, slug)))
          .limit(1);
        if (existing[0]) {
          listId = existing[0].id;
        } else {
          const [row] = await this.db
            .insert(schema.lists)
            .values({
              userId: this.userId,
              name,
              slug,
              type: l.type === "collection" ? "collection" : "list",
              isPublic: l.isPublic,
            })
            .returning({ id: schema.lists.id });
          listId = row!.id;
        }
      }
      listCount++;

      let position = 0;
      for (const obj of l.objects) {
        position++;
        // list objects reference TVDB series ids; resolve to catalog show ids.
        if (obj.type === "series") {
          const showId = showIdByTvdb.get(obj.id);
          if (showId === undefined) {
            log.debug("List item show not in catalog", { tvdbId: obj.id, list: slug });
            continue;
          }
          if (slug === "favorite-series") favoriteShowIds.add(showId);
          if (!this.dryRun) {
            await this.db
              .insert(schema.listItems)
              .values({ listId, refType: "show", refId: showId, position })
              .onConflictDoNothing();
          }
          itemCount++;
        }
        // movies/episodes in lists are not hydrated in this export (favorite-movies is empty) — skip.
      }
    }

    // Fold favorite-series list into follows.is_favorite (the export's is_favorited column is all 0).
    if (!this.dryRun && favoriteShowIds.size > 0) {
      for (const showId of favoriteShowIds) {
        await this.db
          .update(schema.follows)
          .set({ isFavorite: true })
          .where(and(eq(schema.follows.userId, this.userId), eq(schema.follows.showId, showId)));
      }
    }
    log.info(`Imported ${listCount} lists, ${itemCount} items, ${favoriteShowIds.size} favorites`);

    // Comments: the export carries read-markers/entity uuids but NO free-text body,
    // so there is nothing meaningful to import. We attempt any body field defensively.
    const comments = readComments(this.dataDir);
    const withBody = comments.filter((c) => c.body && c.body.length > 0);
    if (withBody.length === 0) {
      log.info(`comments-prod-comments.csv has ${comments.length} rows but no body text — nothing to import.`);
    } else {
      let n = 0;
      for (const c of withBody) {
        const ep = this.findEpisode(c.seriesName, c.seasonNumber, c.episodeNumber);
        const refType: "episode" | "show" = ep ? "episode" : "show";
        const refId = ep?.id ?? this.resolveShowCtx(undefined, c.seriesName)?.showId;
        if (refId === undefined) continue;
        if (!this.dryRun) {
          await this.db.insert(schema.comments).values({
            userId: this.userId,
            refType,
            refId,
            body: c.body!,
            createdAt: c.createdAt ?? new Date(),
          });
        }
        n++;
      }
      log.info(`Imported ${n} comments`);
    }

    // ── Movies (best-effort per-title from the v1 dump) ──
    // The export has no clean per-title movie *watch* table; v1 tracking-prod-records
    // carries movie_name rows (216 distinct ≈ the 215 aggregate). We resolve each via
    // TMDB search for real metadata; unresolved titles get a sentinel tmdb_id so a
    // catalog_movies row (and its movie_watch) still exists. See README for the gap.
    const movies = readV1Movies(this.dataDir);
    let movieCount = 0;
    await this.emit(6, "Importing movies", 0, movies.length);
    for (const m of movies) {
      // Each movie hits TMDB (search + details), so report per-title progress.
      await this.emit(6, "Importing movies", movieCount, movies.length, m.title);
      let tmdbId: number | null = null;
      let runtimeMin: number | null = m.runtimeSec && m.runtimeSec > 0 ? Math.round(m.runtimeSec / 60) : null;
      let poster: string | null = null;
      let title = m.title;
      let releaseDate: string | null = null;
      const hit = await this.tmdb.searchMovie(m.title, m.year);
      if (hit) {
        tmdbId = hit.tmdbId;
        const full = await this.tmdb.getMovie(hit.tmdbId);
        if (full) {
          runtimeMin = full.runtime ?? runtimeMin;
          poster = full.poster_path ?? null;
          title = full.title ?? title;
          releaseDate = full.release_date ?? null;
        }
      } else {
        this.moviesFailed.push(m.title);
      }
      const movieId = await this.upsertMovie(tmdbId, title, runtimeMin, poster, releaseDate, log);
      if (!this.dryRun) {
        await this.db
          .insert(schema.movieWatches)
          .values({ userId: this.userId, movieId, watchedAt: m.watchedAt ?? null, platform: null })
          .onConflictDoUpdate({
            target: [schema.movieWatches.userId, schema.movieWatches.movieId],
            set: { watchedAt: m.watchedAt ?? null },
          });
      }
      movieCount++;
    }
    log.info(`Imported ${movieCount} movies (${this.moviesFailed.length} unresolved on TMDB)`);
    await this.emit(6, "Importing movies", movies.length, movies.length);
    done();
  }

  /** Deterministic 31-bit positive hash for sentinel movie tmdb ids. */
  private hash31(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return Math.abs(h) || 1;
  }

  private async upsertMovie(
    tmdbId: number | null,
    title: string,
    runtimeMin: number | null,
    posterPath: string | null,
    releaseDate: string | null,
    log?: StepLogger,
  ): Promise<number> {
    if (this.dryRun) return this.next();
    // Resolved movies key on their real (positive) tmdb_id. Unresolved ones need a
    // synthetic, non-null, unique id → sentinel = -hash(title). n5: hash31 collisions
    // are negligible (most titles resolve to real ids), but if two *different*
    // unresolved titles ever hash-collide we probe to the next free sentinel and log,
    // rather than silently merging two movies into one row.
    let effectiveTmdb = tmdbId ?? -this.hash31(normName(title));
    if (tmdbId === null) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const clash = await this.db
          .select({ id: schema.catalogMovies.id, title: schema.catalogMovies.title })
          .from(schema.catalogMovies)
          .where(eq(schema.catalogMovies.tmdbId, effectiveTmdb))
          .limit(1);
        if (!clash[0] || normName(clash[0].title) === normName(title)) break; // free, or our own row
        log?.warn("Movie sentinel collision — probing next id", { title, other: clash[0].title });
        effectiveTmdb -= 1_000_003; // large prime step keeps it clear of other hashes
      }
    }
    const values = { tmdbId: effectiveTmdb, title, posterPath, overview: null, runtimeMin, releaseDate: releaseDate || null };
    const existing = await this.db
      .select({ id: schema.catalogMovies.id })
      .from(schema.catalogMovies)
      .where(eq(schema.catalogMovies.tmdbId, effectiveTmdb))
      .limit(1);
    if (existing[0]) {
      await this.db.update(schema.catalogMovies).set(values).where(eq(schema.catalogMovies.id, existing[0].id));
      return existing[0].id;
    }
    const [row] = await this.db.insert(schema.catalogMovies).values(values).returning({ id: schema.catalogMovies.id });
    return row!.id;
  }

  // ── Step 7: recompute user_stats + VALIDATION report ────────────────────────
  private async step7Stats(only?: number): Promise<ValidationReport> {
    const log = new StepLogger(7);
    const done = log.begin("Recompute user_stats & validate");
    await this.emit(7, "Recomputing statistics", 0, 1);

    // ---- Seed stats_monthly from the pre-computed monthly aggregates ----
    const monthly = readMonthlyStats(this.dataDir);
    if (!this.dryRun) {
      for (const m of monthly) {
        await this.db
          .insert(schema.statsMonthly)
          .values({ userId: this.userId, period: m.period, episodes: m.episodes, minutes: m.minutes })
          .onConflictDoUpdate({
            target: [schema.statsMonthly.userId, schema.statsMonthly.period],
            set: { episodes: m.episodes, minutes: m.minutes },
          });
      }
    }
    this.monthsSeeded = monthly.length;

    // ---- Control values: the authoritative tracking-stats aggregate ----
    const ts = readTrackingStats(this.dataDir);
    const expectedEpisodes = ts?.episodes ?? this.trackedEpisodes + this.fallbackEpisodes;
    const expectedMovies = ts?.movies ?? 0;
    const expectedSeriesMinutes = Math.round((ts?.seriesRuntimeSec ?? 0) / 60);
    const expectedMovieMinutes = Math.round((ts?.moviesRuntimeSec ?? 0) / 60);

    let computedEpisodes = 0;
    let computedSeriesMinutes = 0;
    let computedMovies = 0;
    let computedMovieMinutes = 0;
    let showsFollowed = 0;

    if (this.dryRun) {
      const est = await this.estimateDryRun();
      computedEpisodes = est.episodes;
      computedSeriesMinutes = est.seriesMinutes;
      computedMovies = est.movies;
      computedMovieMinutes = est.movieMinutes;
      showsFollowed = [...this.shows.values()].filter((c) => c.follow).length;
    } else {
      const epRows = await this.db
        .select({
          cnt: sql<number>`count(*)::int`,
          minutes: sql<number>`coalesce(sum(${schema.episodeWatches.watchCount} * coalesce(${schema.catalogEpisodes.runtimeMin}, 0)), 0)::int`,
        })
        .from(schema.episodeWatches)
        .innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
        .where(eq(schema.episodeWatches.userId, this.userId));
      computedEpisodes = Number(epRows[0]?.cnt ?? 0); // COUNT(DISTINCT episode) by construction (unique per user,episode)
      computedSeriesMinutes = Number(epRows[0]?.minutes ?? 0);

      const mvRows = await this.db
        .select({
          cnt: sql<number>`count(*)::int`,
          minutes: sql<number>`coalesce(sum(coalesce(${schema.catalogMovies.runtimeMin}, 0)), 0)::int`,
        })
        .from(schema.movieWatches)
        .innerJoin(schema.catalogMovies, eq(schema.movieWatches.movieId, schema.catalogMovies.id))
        .where(eq(schema.movieWatches.userId, this.userId));
      computedMovies = Number(mvRows[0]?.cnt ?? 0);
      computedMovieMinutes = Number(mvRows[0]?.minutes ?? 0);

      const fRows = await this.db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(schema.follows)
        .where(eq(schema.follows.userId, this.userId));
      showsFollowed = Number(fRows[0]?.cnt ?? 0);

      const minutesWatched = computedSeriesMinutes + computedMovieMinutes;
      await this.db
        .insert(schema.userStats)
        .values({
          userId: this.userId,
          episodesWatched: computedEpisodes,
          moviesWatched: computedMovies,
          minutesWatched,
          showsFollowed,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.userStats.userId,
          set: {
            episodesWatched: computedEpisodes,
            moviesWatched: computedMovies,
            minutesWatched,
            showsFollowed,
            updatedAt: new Date(),
          },
        });
    }

    const computedTotalMinutes = computedSeriesMinutes + computedMovieMinutes;
    const expectedTotalMinutes = expectedSeriesMinutes + expectedMovieMinutes;
    const pct = (got: number, exp: number) => (exp === 0 ? 0 : ((got - exp) / exp) * 100);
    const report: ValidationReport = {
      computedEpisodes,
      expectedEpisodes,
      episodeDeltaPct: pct(computedEpisodes, expectedEpisodes),
      computedSeriesMinutes,
      expectedSeriesMinutes,
      seriesMinuteDeltaPct: pct(computedSeriesMinutes, expectedSeriesMinutes),
      computedMovies,
      expectedMovies,
      computedMovieMinutes,
      expectedMovieMinutes,
      computedTotalMinutes,
      expectedTotalMinutes,
      totalMinuteDeltaPct: pct(computedTotalMinutes, expectedTotalMinutes),
      trackedEpisodes: this.trackedEpisodes,
      fallbackEpisodes: this.fallbackEpisodes,
      monthsSeeded: this.monthsSeeded,
      showsFollowed,
      showsResolved: this.shows.size - this.failedShows.length,
      showsFailed: this.failedShows,
      moviesFailed: this.moviesFailed,
    };

    this.printReport(report);
    await this.emit(7, "Recomputing statistics", 1, 1);
    done();
    void only;
    return report;
  }

  /** Dry-run estimate: reconstruct counts in memory without touching the DB. Mirrors step 3/4/6. */
  private async estimateDryRun(): Promise<{ episodes: number; seriesMinutes: number; movies: number; movieMinutes: number }> {
    const runtimeOf = (ctx: ShowContext, s: number, e: number, trackingSec?: number): number => {
      if (trackingSec && trackingSec > 0) return Math.round(trackingSec / 60);
      return ctx.episodes.get(epKey(s, e))?.runtimeMin ?? ctx.runtimeAvg ?? 0;
    };

    // 3a. tracking primary — dedupe by distinct (show, season, episode) so the
    // estimate matches the real run, which stores one row per (user, episode).
    // A few episodes appear on multiple tracking rows (e.g. Money Heist S2E0 ×3);
    // the real upsert keeps the last write, so we keep the last-seen values here too.
    const covered = new Set<string>();
    const distinct = new Map<string, { runtimeMin: number; watchCount: number }>();
    for (const w of readTrackingWatches(this.dataDir)) {
      const ctx = this.resolveShowCtx(w.showTvdbId, w.seriesName);
      if (!ctx) continue;
      covered.add(ctx.key);
      distinct.set(`${ctx.key}|${w.seasonNumber}|${w.episodeNumber}`, {
        runtimeMin: runtimeOf(ctx, w.seasonNumber, w.episodeNumber, w.runtimeSec),
        watchCount: 1 + w.rewatchCount,
      });
    }
    let episodes = distinct.size;
    let seriesMinutes = 0;
    for (const d of distinct.values()) seriesMinutes += d.watchCount * d.runtimeMin;

    // 3b. watermark fallback for uncovered shows
    const seenSources = readSeenEpisodeSources(this.dataDir);
    const seByEpisodeTvdb = new Map<number, SE>();
    for (const s of seenSources) seByEpisodeTvdb.set(s.episodeTvdbId, { season: s.seasonNumber, episode: s.episodeNumber });
    const wmByKey = new Map<string, import("./csv.js").Watermark>();
    for (const wm of readWatermarks(this.dataDir)) {
      const ctx = this.resolveShowCtx(wm.tvdbId, wm.tvShowName);
      if (ctx) wmByKey.set(ctx.key, wm);
    }
    for (const ctx of this.shows.values()) {
      if (covered.has(ctx.key) || ctx.ordered.length === 0) continue;
      const wm = wmByKey.get(ctx.key);
      if (!wm && ctx.nbEpisodesSeen === 0) continue;
      const se = wm ? (await this.resolveWatermark(wm, ctx, seByEpisodeTvdb)).se : null;
      const toMark = se
        ? ctx.ordered.filter((e) => e.season < se.season || (e.season === se.season && e.episode <= se.episode))
        : ctx.ordered.slice(0, ctx.nbEpisodesSeen || ctx.ordered.length);
      for (const ep of toMark) {
        episodes++;
        seriesMinutes += ep.runtimeMin ?? ctx.runtimeAvg ?? 0;
      }
    }

    // movies (runtime from v1 only in dry-run; TMDB runtimes would raise this)
    const movieList = readV1Movies(this.dataDir);
    const movieMinutes = movieList.reduce((s, m) => s + (m.runtimeSec ? Math.round(m.runtimeSec / 60) : 0), 0);
    return { episodes, seriesMinutes, movies: movieList.length, movieMinutes };
  }

  private printReport(r: ValidationReport): void {
    const h = (m: number) => (m / 60).toFixed(0);
    const line = "─".repeat(66);
    const fmt = (got: number, exp: number, d: number) => `computed=${got}  expected=${exp}  Δ=${d.toFixed(1)}%`;
    console.log(`\n${line}\n  ShowTrackr import — VALIDATION REPORT${this.dryRun ? "  (DRY RUN)" : ""}\n${line}`);
    console.log(`  Shows followed        : ${r.showsFollowed}`);
    console.log(`  Shows resolved (TMDB) : ${r.showsResolved}/${this.shows.size}`);
    console.log(`  Episode provenance    : ${r.trackedEpisodes} tracking + ${r.fallbackEpisodes} watermark-fallback`);
    console.log(`  Monthly stats seeded  : ${r.monthsSeeded} months`);
    console.log(line);
    console.log(`  Episodes       ${fmt(r.computedEpisodes, r.expectedEpisodes, r.episodeDeltaPct)}`);
    console.log(
      `  Series minutes ${fmt(r.computedSeriesMinutes, r.expectedSeriesMinutes, r.seriesMinuteDeltaPct)}  (${h(r.computedSeriesMinutes)}h / ${h(r.expectedSeriesMinutes)}h)`,
    );
    console.log(
      `  Movies         computed=${r.computedMovies}  expected=${r.expectedMovies}` +
        (r.computedMovies < r.expectedMovies
          ? `  (Δ explained: per-title data has no rewatch instances; ${r.expectedMovies - r.computedMovies} rewatch/dup watches not represented — not an error)`
          : ""),
    );
    console.log(`  Movie minutes  computed=${r.computedMovieMinutes} (${h(r.computedMovieMinutes)}h)  expected=${r.expectedMovieMinutes} (${h(r.expectedMovieMinutes)}h)`);
    console.log(
      `  TOTAL minutes  ${fmt(r.computedTotalMinutes, r.expectedTotalMinutes, r.totalMinuteDeltaPct)}  (${h(r.computedTotalMinutes)}h / ${h(r.expectedTotalMinutes)}h)`,
    );
    console.log(line);
    const ok = Math.abs(r.episodeDeltaPct) < 2 && Math.abs(r.totalMinuteDeltaPct) < 5;
    console.log(`  Result: ${ok ? "✅ episodes <2% & minutes <5% (PLAN M3 target)" : "⚠️  outside target — review deltas"}`);
    if (r.showsFailed.length > 0) {
      console.log(`${line}\n  ⚠️  ${r.showsFailed.length} shows FAILED TMDB resolution (manual fixup):`);
      for (const s of r.showsFailed.slice(0, 40)) console.log(`      - ${s}`);
      if (r.showsFailed.length > 40) console.log(`      … and ${r.showsFailed.length - 40} more`);
    }
    if (r.moviesFailed.length > 0) {
      console.log(`  ⚠️  ${r.moviesFailed.length} movies unresolved on TMDB (stub catalog_movies row created).`);
    }
    console.log(line + "\n");
  }
}
