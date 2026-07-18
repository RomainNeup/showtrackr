/**
 * Database access. All DB usage in the app goes through this module so the
 * connection is created exactly once per process. The Drizzle schema + client
 * factory come from the `@showtrackr/db` workspace package (see CONTRACT.md).
 *
 * We only ever import from `$lib/server/*`, keeping the DB + secrets off the
 * client bundle (SvelteKit enforces this boundary).
 */
import { env } from '$env/dynamic/private';
import { createDb, schema, type Database } from '@showtrackr/db';

// Lazily create the connection on first use. We must NOT connect (or throw) at
// module-load time: SvelteKit's build/analyse step imports server modules with
// an empty env, and a top-level throw would fail the build. The connection is
// established the first time a query is issued at runtime.
let instance: ReturnType<typeof createDb> | null = null;

function connection() {
	if (!instance) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set — cannot connect to the database.');
		instance = createDb(env.DATABASE_URL);
	}
	return instance;
}

/**
 * Singleton Drizzle client (lazy). Proxied so `db.select()`, `db.insert()`, …
 * resolve to the real instance the first time they're accessed, bound correctly.
 */
export const db: Database = new Proxy({} as Database, {
	get(_target, prop, receiver) {
		const real = connection().db as unknown as Record<string | symbol, unknown>;
		const value = Reflect.get(real, prop, receiver);
		return typeof value === 'function' ? value.bind(real) : value;
	}
});

/** Underlying postgres.js connection — call `.end()` on graceful shutdown. */
export function dbClient() {
	return connection().client;
}

/** Re-export the schema so callers use a single import site. */
export { schema };

// ── Inferred row types (derived from the shared schema, not redefined) ──────
export type User = typeof schema.users.$inferSelect;
export type Setting = typeof schema.settings.$inferSelect;
export type CatalogShow = typeof schema.catalogShows.$inferSelect;
export type CatalogSeason = typeof schema.catalogSeasons.$inferSelect;
export type CatalogEpisode = typeof schema.catalogEpisodes.$inferSelect;
export type CatalogMovie = typeof schema.catalogMovies.$inferSelect;
export type Follow = typeof schema.follows.$inferSelect;
export type EpisodeWatch = typeof schema.episodeWatches.$inferSelect;
export type MovieWatch = typeof schema.movieWatches.$inferSelect;
export type EpisodeRating = typeof schema.episodeRatings.$inferSelect;
export type MovieRating = typeof schema.movieRatings.$inferSelect;
export type EpisodeEmotion = typeof schema.episodeEmotions.$inferSelect;
export type List = typeof schema.lists.$inferSelect;
export type ListItem = typeof schema.listItems.$inferSelect;
export type Comment = typeof schema.comments.$inferSelect;
export type UserStats = typeof schema.userStats.$inferSelect;

export type FollowStatus = 'watching' | 'archived' | 'stopped' | 'upcoming';
