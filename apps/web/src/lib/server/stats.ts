/**
 * Viewing statistics. The core formula is fixed by CONTRACT.md:
 *
 *   minutes_watched =
 *       Σ(episode_watches.watch_count × catalog_episodes.runtime_min)
 *     + Σ(movie_watches × catalog_movies.runtime_min)
 *
 * `recomputeUserStats` writes the aggregate into `user_stats` (invalidated on
 * every mark). The richer breakdowns (per month/week, top shows) are computed
 * on demand for the Stats screen.
 *
 * CONTRACT (frozen): `episodes_watched = COUNT(DISTINCT episode)`, NOT
 * SUM(watch_count). Rewatches count toward MINUTES only (matches the ~3601
 * episode control value). `episode_watches` is unique per (user, episode), so
 * `count(*)` over it == distinct episodes.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, type UserStats } from './db';

/** Recompute and persist the `user_stats` aggregate row for a user. */
export async function recomputeUserStats(userId: number): Promise<UserStats> {
	const [epMinutes] = await db
		.select({
			minutes: sql<number>`coalesce(sum(${schema.episodeWatches.watchCount} * coalesce(${schema.catalogEpisodes.runtimeMin}, 0)), 0)::int`,
			episodes: sql<number>`count(*)::int`
		})
		.from(schema.episodeWatches)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
		.where(eq(schema.episodeWatches.userId, userId));

	const [mvMinutes] = await db
		.select({
			minutes: sql<number>`coalesce(sum(coalesce(${schema.catalogMovies.runtimeMin}, 0)), 0)::int`,
			movies: sql<number>`count(*)::int`
		})
		.from(schema.movieWatches)
		.innerJoin(schema.catalogMovies, eq(schema.movieWatches.movieId, schema.catalogMovies.id))
		.where(eq(schema.movieWatches.userId, userId));

	const [followRow] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.follows)
		.where(eq(schema.follows.userId, userId));

	const minutesWatched = (epMinutes?.minutes ?? 0) + (mvMinutes?.minutes ?? 0);

	const [row] = await db
		.insert(schema.userStats)
		.values({
			userId,
			episodesWatched: epMinutes?.episodes ?? 0,
			moviesWatched: mvMinutes?.movies ?? 0,
			minutesWatched,
			showsFollowed: followRow?.n ?? 0,
			updatedAt: new Date()
		})
		.onConflictDoUpdate({
			target: schema.userStats.userId,
			set: {
				episodesWatched: epMinutes?.episodes ?? 0,
				moviesWatched: mvMinutes?.movies ?? 0,
				minutesWatched,
				showsFollowed: followRow?.n ?? 0,
				updatedAt: new Date()
			}
		})
		.returning();

	return row;
}

export type StatsBreakdown = {
	episodesWatched: number;
	moviesWatched: number;
	minutesWatched: number;
	showsFollowed: number;
	perMonth: Array<{ period: string; minutes: number; episodes: number }>;
	perWeek: Array<{ period: string; minutes: number; episodes: number }>;
	topShows: Array<{ showId: number; name: string; posterPath: string | null; minutes: number; episodes: number }>;
};

/** Full breakdown for the Stats screen (reads the persisted aggregate + queries). */
export async function getStatsBreakdown(userId: number): Promise<StatsBreakdown> {
	const [totals] = await db
		.select()
		.from(schema.userStats)
		.where(eq(schema.userStats.userId, userId))
		.limit(1);

	// Recompute per-month/week from episode_watches — the COMPLETE source (real
	// dates for all ~3601 episodes). `stats_monthly` is only a partial seed
	// (~22 months) and must NOT override this, or history would truncate.
	const perMonth = await bucketedMinutes(userId, 'month');
	const perWeek = await bucketedMinutes(userId, 'week');

	const topShows = await db
		.select({
			showId: schema.catalogShows.id,
			name: schema.catalogShows.name,
			posterPath: schema.catalogShows.posterPath,
			minutes: sql<number>`coalesce(sum(${schema.episodeWatches.watchCount} * coalesce(${schema.catalogEpisodes.runtimeMin}, 0)), 0)::int`,
			episodes: sql<number>`count(*)::int`
		})
		.from(schema.episodeWatches)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
		.innerJoin(schema.catalogShows, eq(schema.catalogEpisodes.showId, schema.catalogShows.id))
		.where(eq(schema.episodeWatches.userId, userId))
		.groupBy(schema.catalogShows.id, schema.catalogShows.name, schema.catalogShows.posterPath);

	// Sort by minutes watched in JS (portable across drivers) and take the top.
	topShows.sort((a, b) => b.minutes - a.minutes);

	return {
		episodesWatched: totals?.episodesWatched ?? 0,
		moviesWatched: totals?.moviesWatched ?? 0,
		minutesWatched: totals?.minutesWatched ?? 0,
		showsFollowed: totals?.showsFollowed ?? 0,
		perMonth,
		perWeek,
		topShows: topShows.slice(0, 8)
	};
}

async function bucketedMinutes(
	userId: number,
	unit: 'month' | 'week'
): Promise<Array<{ period: string; minutes: number; episodes: number }>> {
	// Bucket episode watches by their last_watched_at timestamp. Month buckets
	// use 'YYYY-MM'; weeks keep the day.
	const fmt = unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
	const rows = await db
		.select({
			period: sql<string>`to_char(date_trunc(${unit}, ${schema.episodeWatches.lastWatchedAt}), ${fmt})`,
			minutes: sql<number>`coalesce(sum(${schema.episodeWatches.watchCount} * coalesce(${schema.catalogEpisodes.runtimeMin}, 0)), 0)::int`,
			episodes: sql<number>`count(*)::int`
		})
		.from(schema.episodeWatches)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
		.where(
			and(
				eq(schema.episodeWatches.userId, userId),
				sql`${schema.episodeWatches.lastWatchedAt} is not null`
			)
		)
		.groupBy(sql`1`)
		.orderBy(sql`1`);
	// Return the most recent 12 buckets.
	return rows.slice(-12);
}
