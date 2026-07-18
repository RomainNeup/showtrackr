/**
 * @mytvtime/db — public barrel.
 *
 * Re-exports the Drizzle schema, the `createDb` client factory, and inferred
 * TypeScript row types for every table. Consumers should import from here:
 *
 *   import { createDb, catalogShows, type Show } from '@mytvtime/db';
 */
export * from './schema.js';
export { createDb, type Database, type CreateDbResult, type CreateDbOptions } from './client.js';

import type {
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
} from './schema.js';

/* ─────────────────── Inferred SELECT (row) types ─────────────────── */

export type User = typeof users.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Show = typeof catalogShows.$inferSelect;
export type Season = typeof catalogSeasons.$inferSelect;
export type Episode = typeof catalogEpisodes.$inferSelect;
export type Movie = typeof catalogMovies.$inferSelect;
export type WatchProvidersRow = typeof catalogWatchProviders.$inferSelect;
export type Follow = typeof follows.$inferSelect;
export type EpisodeWatch = typeof episodeWatches.$inferSelect;
export type MovieWatch = typeof movieWatches.$inferSelect;
export type EpisodeRating = typeof episodeRatings.$inferSelect;
export type MovieRating = typeof movieRatings.$inferSelect;
export type EpisodeEmotion = typeof episodeEmotions.$inferSelect;
export type List = typeof lists.$inferSelect;
export type ListItem = typeof listItems.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type StatsMonthly = typeof statsMonthly.$inferSelect;
export type UserStats = typeof userStats.$inferSelect;

/* ─────────────────── Inferred INSERT types ───────────────────────── */

export type NewUser = typeof users.$inferInsert;
export type NewSetting = typeof settings.$inferInsert;
export type NewShow = typeof catalogShows.$inferInsert;
export type NewSeason = typeof catalogSeasons.$inferInsert;
export type NewEpisode = typeof catalogEpisodes.$inferInsert;
export type NewMovie = typeof catalogMovies.$inferInsert;
export type NewWatchProvidersRow = typeof catalogWatchProviders.$inferInsert;
export type NewFollow = typeof follows.$inferInsert;
export type NewEpisodeWatch = typeof episodeWatches.$inferInsert;
export type NewMovieWatch = typeof movieWatches.$inferInsert;
export type NewEpisodeRating = typeof episodeRatings.$inferInsert;
export type NewMovieRating = typeof movieRatings.$inferInsert;
export type NewEpisodeEmotion = typeof episodeEmotions.$inferInsert;
export type NewList = typeof lists.$inferInsert;
export type NewListItem = typeof listItems.$inferInsert;
export type NewComment = typeof comments.$inferInsert;
export type NewStatsMonthly = typeof statsMonthly.$inferInsert;
export type NewUserStats = typeof userStats.$inferInsert;

/* ─────────────────── Enum value unions ───────────────────────────── */

export type FollowStatus = Follow['status'];
export type ListKind = List['type'];
export type RefType = ListItem['refType'];
