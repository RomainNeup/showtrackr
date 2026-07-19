/**
 * ShowTrackr — Drizzle schema (PostgreSQL 16).
 *
 * Authoritative implementation of CONTRACT.md §"Database schema".
 * All ids are bigint (bigserial for auto-increment PKs); all timestamps are timestamptz.
 * Columns are snake_case; TS keys mirror them for zero-surprise SQL.
 */
import {
  pgTable,
  pgEnum,
  bigserial,
  bigint,
  integer,
  text,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

/* ────────────────────────────── Enums ────────────────────────────── */

/** follows.status */
export const followStatus = pgEnum('follow_status', [
  'watching',
  'archived',
  'stopped',
  'upcoming',
]);

/** lists.type */
export const listType = pgEnum('list_type', ['list', 'collection']);

/** list_items.ref_type / comments.ref_type — the polymorphic target kind */
export const refType = pgEnum('ref_type', ['show', 'movie', 'episode']);

/** catalog_watch_providers.kind — a watch-provider row is for a show or a movie */
export const watchProviderKind = pgEnum('watch_provider_kind', ['show', 'movie']);

/** import_jobs.status — lifecycle of a per-user GDPR import job */
export const importStatus = pgEnum('import_status', ['pending', 'running', 'done', 'error']);

/* ───────────────────────────── Users ─────────────────────────────── */

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    // Instance-visibility flag for the Community feature: when true, other users
    // on this instance can see this user's stats & library (never email/hash).
    // Defaults to true (visible) so existing installs opt in by default.
    isPublic: boolean('is_public').notNull().default(true),
    timezone: text('timezone').notNull().default('UTC'),
    language: text('language').notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const settings = pgTable(
  'settings',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/* ─────────────────────────── Catalogue (TMDB cache) ──────────────── */

export const catalogShows = pgTable(
  'catalog_shows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tmdbId: integer('tmdb_id').notNull(),
    tvdbId: integer('tvdb_id'),
    name: text('name').notNull(),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    overview: text('overview'),
    status: text('status'),
    firstAirDate: date('first_air_date'),
    network: text('network'),
    runtimeAvgMin: integer('runtime_avg_min'),
  },
  (t) => [
    uniqueIndex('catalog_shows_tmdb_id_key').on(t.tmdbId),
    index('catalog_shows_tvdb_id_idx').on(t.tvdbId),
  ],
);

export const catalogSeasons = pgTable(
  'catalog_seasons',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    showId: bigint('show_id', { mode: 'number' })
      .notNull()
      .references(() => catalogShows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    name: text('name'),
    episodeCount: integer('episode_count'),
  },
  (t) => [
    uniqueIndex('catalog_seasons_show_season_key').on(t.showId, t.seasonNumber),
    index('catalog_seasons_show_id_idx').on(t.showId),
  ],
);

export const catalogEpisodes = pgTable(
  'catalog_episodes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    showId: bigint('show_id', { mode: 'number' })
      .notNull()
      .references(() => catalogShows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    name: text('name'),
    airDate: date('air_date'),
    runtimeMin: integer('runtime_min'),
    tmdbId: integer('tmdb_id'),
    tvdbEpisodeId: integer('tvdb_episode_id'),
  },
  (t) => [
    uniqueIndex('catalog_episodes_show_season_episode_key').on(
      t.showId,
      t.seasonNumber,
      t.episodeNumber,
    ),
    index('catalog_episodes_show_id_idx').on(t.showId),
  ],
);

export const catalogMovies = pgTable(
  'catalog_movies',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tmdbId: integer('tmdb_id').notNull(),
    title: text('title').notNull(),
    posterPath: text('poster_path'),
    overview: text('overview'),
    runtimeMin: integer('runtime_min'),
    releaseDate: date('release_date'),
  },
  (t) => [uniqueIndex('catalog_movies_tmdb_id_key').on(t.tmdbId)],
);

/**
 * Cache-through storage of TMDB "watch/providers" (data powered by JustWatch).
 * A single TMDB call returns ALL countries, so we store the FULL `results`
 * object verbatim as jsonb (keyed by ISO country code) and pick the region at
 * read time — switching region later needs no new API call. Upsert-only,
 * refreshed when `fetched_at` goes stale (see the app's cache-through helper).
 */
export const catalogWatchProviders = pgTable(
  'catalog_watch_providers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: watchProviderKind('kind').notNull(),
    tmdbId: bigint('tmdb_id', { mode: 'number' }).notNull(),
    // Full TMDB `results` object: { [ISO_COUNTRY]: { link, flatrate?, rent?, buy?, … } }.
    results: jsonb('results').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('catalog_watch_providers_kind_tmdb_key').on(t.kind, t.tmdbId)],
);

/* ─────────────────────────── User data ───────────────────────────── */

export const follows = pgTable(
  'follows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showId: bigint('show_id', { mode: 'number' })
      .notNull()
      .references(() => catalogShows.id, { onDelete: 'restrict' }),
    status: followStatus('status').notNull().default('watching'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    notify: boolean('notify').notNull().default(true),
    followedAt: timestamp('followed_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source'),
  },
  (t) => [
    uniqueIndex('follows_user_show_key').on(t.userId, t.showId),
    index('follows_user_id_idx').on(t.userId),
    index('follows_show_id_idx').on(t.showId),
  ],
);

export const episodeWatches = pgTable(
  'episode_watches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: bigint('episode_id', { mode: 'number' })
      .notNull()
      .references(() => catalogEpisodes.id, { onDelete: 'restrict' }),
    watchCount: integer('watch_count').notNull().default(1),
    firstWatchedAt: timestamp('first_watched_at', { withTimezone: true }),
    lastWatchedAt: timestamp('last_watched_at', { withTimezone: true }),
    platform: text('platform'),
  },
  (t) => [
    uniqueIndex('episode_watches_user_episode_key').on(t.userId, t.episodeId),
    index('episode_watches_user_id_idx').on(t.userId),
    index('episode_watches_episode_id_idx').on(t.episodeId),
  ],
);

export const movieWatches = pgTable(
  'movie_watches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    movieId: bigint('movie_id', { mode: 'number' })
      .notNull()
      .references(() => catalogMovies.id, { onDelete: 'restrict' }),
    watchCount: integer('watch_count').notNull().default(1),
    watchedAt: timestamp('watched_at', { withTimezone: true }),
    platform: text('platform'),
  },
  (t) => [
    uniqueIndex('movie_watches_user_movie_key').on(t.userId, t.movieId),
    index('movie_watches_user_id_idx').on(t.userId),
    index('movie_watches_movie_id_idx').on(t.movieId),
  ],
);

export const episodeRatings = pgTable(
  'episode_ratings',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: bigint('episode_id', { mode: 'number' })
      .notNull()
      .references(() => catalogEpisodes.id, { onDelete: 'restrict' }),
    rating: integer('rating').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId] }),
    index('episode_ratings_episode_id_idx').on(t.episodeId),
  ],
);

export const movieRatings = pgTable(
  'movie_ratings',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    movieId: bigint('movie_id', { mode: 'number' })
      .notNull()
      .references(() => catalogMovies.id, { onDelete: 'restrict' }),
    rating: integer('rating').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.movieId] }),
    index('movie_ratings_movie_id_idx').on(t.movieId),
  ],
);

export const episodeEmotions = pgTable(
  'episode_emotions',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: bigint('episode_id', { mode: 'number' })
      .notNull()
      .references(() => catalogEpisodes.id, { onDelete: 'restrict' }),
    emotionId: integer('emotion_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId, t.emotionId] }),
    index('episode_emotions_episode_id_idx').on(t.episodeId),
  ],
);

export const lists = pgTable(
  'lists',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    type: listType('type').notNull().default('list'),
    isPublic: boolean('is_public').notNull().default(false),
  },
  (t) => [
    uniqueIndex('lists_user_slug_key').on(t.userId, t.slug),
    index('lists_user_id_idx').on(t.userId),
  ],
);

export const listItems = pgTable(
  'list_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    listId: bigint('list_id', { mode: 'number' })
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    refType: refType('ref_type').notNull(),
    refId: bigint('ref_id', { mode: 'number' }).notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('list_items_list_ref_key').on(t.listId, t.refType, t.refId),
    index('list_items_list_id_idx').on(t.listId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refType: refType('ref_type').notNull(),
    refId: bigint('ref_id', { mode: 'number' }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comments_user_id_idx').on(t.userId),
    index('comments_ref_idx').on(t.refType, t.refId),
  ],
);

/** Pre-computed monthly rollups (seeded from export, refreshed on new watches). */
export const statsMonthly = pgTable(
  'stats_monthly',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    period: text('period').notNull(), // 'YYYY-MM'
    episodes: integer('episodes').notNull().default(0),
    minutes: integer('minutes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })],
);

export const userStats = pgTable('user_stats', {
  userId: bigint('user_id', { mode: 'number' })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  episodesWatched: integer('episodes_watched').notNull().default(0),
  moviesWatched: integer('movies_watched').notNull().default(0),
  minutesWatched: bigint('minutes_watched', { mode: 'number' }).notNull().default(0),
  showsFollowed: integer('shows_followed').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-user "Import from TV Time" background jobs.
 *
 * One row tracks a single upload+reconstruction run for a user, updated live from
 * the pipeline's `onProgress` callback so the UI can poll it. `status` drives the
 * concurrency guard (a user may not start a new import while one is pending/running)
 * and the restart-recovery sweep (pending/running jobs from a previous process are
 * marked stale on the next import request).
 */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: importStatus('status').notNull().default('pending'),
    step: integer('step').notNull().default(0),
    stepLabel: text('step_label'),
    processed: integer('processed').notNull().default(0),
    total: integer('total').notNull().default(0),
    message: text('message'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('import_jobs_user_id_idx').on(t.userId),
    index('import_jobs_user_status_idx').on(t.userId, t.status),
  ],
);

/* ─────────────────────── Barrel of all tables ────────────────────── */

export const schema = {
  users,
  settings,
  catalogShows,
  catalogSeasons,
  catalogEpisodes,
  catalogMovies,
  catalogWatchProviders,
  follows,
  episodeWatches,
  movieWatches,
  episodeRatings,
  movieRatings,
  episodeEmotions,
  lists,
  listItems,
  comments,
  statsMonthly,
  userStats,
  importJobs,
  // enums (exported for drizzle-kit + convenience)
  followStatus,
  listType,
  refType,
  watchProviderKind,
  importStatus,
};

export type Schema = typeof schema;
