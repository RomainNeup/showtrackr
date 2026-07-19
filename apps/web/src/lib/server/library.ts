/**
 * User-library mutations + reads: follow/unfollow, mark watched (episode /
 * season / whole show / movie), rewatch, rate, emotions. Every mutation that
 * affects viewing time invalidates `user_stats` via recomputeUserStats.
 *
 * These functions are the single source of truth used by the route form
 * actions — keeping business logic out of the `.svelte`/route glue.
 */
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema, type CatalogShow, type FollowStatus } from './db';
import { ensureSeasonEpisodes, ensureShow } from './catalog';
import { recomputeUserStats } from './stats';

// ── Follows ─────────────────────────────────────────────────────────────────
export async function followShow(
	userId: number,
	showId: number,
	status: FollowStatus = 'watching'
): Promise<void> {
	await db
		.insert(schema.follows)
		.values({ userId, showId, status, followedAt: new Date(), source: 'app' })
		.onConflictDoUpdate({
			target: [schema.follows.userId, schema.follows.showId],
			set: { status }
		});
	await recomputeUserStats(userId);
}

export async function unfollowShow(userId: number, showId: number): Promise<void> {
	await db
		.delete(schema.follows)
		.where(and(eq(schema.follows.userId, userId), eq(schema.follows.showId, showId)));
	await recomputeUserStats(userId);
}

export async function setFollowStatus(
	userId: number,
	showId: number,
	status: FollowStatus
): Promise<void> {
	await db
		.update(schema.follows)
		.set({ status })
		.where(and(eq(schema.follows.userId, userId), eq(schema.follows.showId, showId)));
}

export async function setFavorite(userId: number, showId: number, isFavorite: boolean): Promise<void> {
	await db
		.update(schema.follows)
		.set({ isFavorite })
		.where(and(eq(schema.follows.userId, userId), eq(schema.follows.showId, showId)));
}

// ── Episode watches ─────────────────────────────────────────────────────────
/** Toggle a single episode watched/unwatched. */
export async function setEpisodeWatched(
	userId: number,
	episodeId: number,
	watched: boolean
): Promise<void> {
	if (watched) {
		const now = new Date();
		await db
			.insert(schema.episodeWatches)
			.values({ userId, episodeId, watchCount: 1, firstWatchedAt: now, lastWatchedAt: now })
			// Already watched → leave watch_count untouched (use addRewatch for +1).
			.onConflictDoNothing({
				target: [schema.episodeWatches.userId, schema.episodeWatches.episodeId]
			});
	} else {
		await db
			.delete(schema.episodeWatches)
			.where(
				and(eq(schema.episodeWatches.userId, userId), eq(schema.episodeWatches.episodeId, episodeId))
			);
	}
	await recomputeUserStats(userId);
}

/** Increment watch_count (a rewatch), creating the row if needed. */
export async function addRewatch(userId: number, episodeId: number): Promise<void> {
	const now = new Date();
	await db
		.insert(schema.episodeWatches)
		.values({ userId, episodeId, watchCount: 2, firstWatchedAt: now, lastWatchedAt: now })
		.onConflictDoUpdate({
			target: [schema.episodeWatches.userId, schema.episodeWatches.episodeId],
			set: {
				watchCount: sql`${schema.episodeWatches.watchCount} + 1`,
				lastWatchedAt: now
			}
		});
	await recomputeUserStats(userId);
}

/** Mark every episode of a season watched (ensures the season is cached first). */
export async function markSeasonWatched(
	userId: number,
	show: CatalogShow,
	seasonNumber: number
): Promise<void> {
	const episodes = await ensureSeasonEpisodes(show, seasonNumber);
	await markEpisodesWatched(
		userId,
		episodes.map((e) => e.id)
	);
	await recomputeUserStats(userId);
}

/** Mark the entire show watched across all cached seasons. */
export async function markShowWatched(userId: number, show: CatalogShow): Promise<void> {
	const seasons = await db
		.select({ seasonNumber: schema.catalogSeasons.seasonNumber })
		.from(schema.catalogSeasons)
		.where(
			and(eq(schema.catalogSeasons.showId, show.id), gt(schema.catalogSeasons.seasonNumber, 0))
		); // exclude specials (season 0), consistent with Up Next

	for (const s of seasons) {
		const episodes = await ensureSeasonEpisodes(show, s.seasonNumber);
		await markEpisodesWatched(
			userId,
			episodes.map((e) => e.id)
		);
	}
	await recomputeUserStats(userId);
}

async function markEpisodesWatched(userId: number, episodeIds: number[]): Promise<void> {
	if (!episodeIds.length) return;
	const now = new Date();
	await db
		.insert(schema.episodeWatches)
		.values(
			episodeIds.map((episodeId) => ({
				userId,
				episodeId,
				watchCount: 1,
				firstWatchedAt: now,
				lastWatchedAt: now
			}))
		)
		.onConflictDoNothing({
			target: [schema.episodeWatches.userId, schema.episodeWatches.episodeId]
		});
}

// ── Season / whole-show rewatch ─────────────────────────────────────────────
/**
 * Keep only episodes that have already aired. Matches the "aired" convention used
 * by getUpNext: an episode counts as aired when it has no known air date OR its
 * air date is in the past. `air_date` is a `date` column that postgres-js hands
 * back as a STRING at runtime — coerce through `new Date(...)` before comparing
 * (never call date methods on the raw value; see the getUpNext note below).
 */
function airedEpisodeIds(episodes: { id: number; airDate: string | Date | null }[]): number[] {
	const now = Date.now();
	return episodes
		.filter((e) => e.airDate == null || new Date(e.airDate).getTime() <= now)
		.map((e) => e.id);
}

/**
 * Bump watch_count by 1 for each episode (a rewatch), creating the row at
 * count 1 when the episode was never marked watched. Mirrors addRewatch but for
 * a batch — one upsert with the set clause referencing the existing row's count.
 */
async function bumpEpisodesRewatch(userId: number, episodeIds: number[]): Promise<void> {
	if (!episodeIds.length) return;
	const now = new Date();
	await db
		.insert(schema.episodeWatches)
		.values(
			episodeIds.map((episodeId) => ({
				userId,
				episodeId,
				watchCount: 1,
				firstWatchedAt: now,
				lastWatchedAt: now
			}))
		)
		.onConflictDoUpdate({
			target: [schema.episodeWatches.userId, schema.episodeWatches.episodeId],
			set: {
				watchCount: sql`${schema.episodeWatches.watchCount} + 1`,
				lastWatchedAt: now
			}
		});
}

/** Rewatch a whole season: +1 watch_count for every AIRED episode of that season. */
export async function markSeasonRewatched(
	userId: number,
	show: CatalogShow,
	seasonNumber: number
): Promise<void> {
	const episodes = await ensureSeasonEpisodes(show, seasonNumber);
	await bumpEpisodesRewatch(userId, airedEpisodeIds(episodes));
	await recomputeUserStats(userId);
}

/** Rewatch the whole show: +1 watch_count for every AIRED episode across all regular seasons. */
export async function markShowRewatched(userId: number, show: CatalogShow): Promise<void> {
	const seasons = await db
		.select({ seasonNumber: schema.catalogSeasons.seasonNumber })
		.from(schema.catalogSeasons)
		.where(
			and(eq(schema.catalogSeasons.showId, show.id), gt(schema.catalogSeasons.seasonNumber, 0))
		); // exclude specials (season 0), consistent with markShowWatched

	for (const s of seasons) {
		const episodes = await ensureSeasonEpisodes(show, s.seasonNumber);
		await bumpEpisodesRewatch(userId, airedEpisodeIds(episodes));
	}
	await recomputeUserStats(userId);
}

// ── Movie watches ─────────────────────────────────────────────────────────
export async function setMovieWatched(
	userId: number,
	movieId: number,
	watched: boolean
): Promise<void> {
	if (watched) {
		await db
			.insert(schema.movieWatches)
			.values({ userId, movieId, watchedAt: new Date() })
			.onConflictDoNothing({
				target: [schema.movieWatches.userId, schema.movieWatches.movieId]
			});
	} else {
		await db
			.delete(schema.movieWatches)
			.where(and(eq(schema.movieWatches.userId, userId), eq(schema.movieWatches.movieId, movieId)));
	}
	await recomputeUserStats(userId);
}

/** Increment a movie's watch_count (a rewatch), creating the row if needed. */
export async function addMovieRewatch(userId: number, movieId: number): Promise<void> {
	const now = new Date();
	await db
		.insert(schema.movieWatches)
		.values({ userId, movieId, watchCount: 2, watchedAt: now })
		.onConflictDoUpdate({
			target: [schema.movieWatches.userId, schema.movieWatches.movieId],
			set: {
				watchCount: sql`${schema.movieWatches.watchCount} + 1`,
				watchedAt: now
			}
		});
	await recomputeUserStats(userId);
}

// ── Ratings & emotions ──────────────────────────────────────────────────────
/** Clamp any incoming rating to the frozen 1..5 star scale (CONTRACT). */
function clampRating(rating: number): number {
	if (!Number.isFinite(rating)) return 1;
	return Math.min(5, Math.max(1, Math.round(rating)));
}

export async function rateEpisode(userId: number, episodeId: number, rating: number): Promise<void> {
	const value = clampRating(rating);
	await db
		.insert(schema.episodeRatings)
		.values({ userId, episodeId, rating: value })
		.onConflictDoUpdate({
			target: [schema.episodeRatings.userId, schema.episodeRatings.episodeId],
			set: { rating: value }
		});
}

export async function rateMovie(userId: number, movieId: number, rating: number): Promise<void> {
	const value = clampRating(rating);
	await db
		.insert(schema.movieRatings)
		.values({ userId, movieId, rating: value })
		.onConflictDoUpdate({
			target: [schema.movieRatings.userId, schema.movieRatings.movieId],
			set: { rating: value }
		});
}

export async function clearEpisodeRating(userId: number, episodeId: number): Promise<void> {
	await db
		.delete(schema.episodeRatings)
		.where(
			and(eq(schema.episodeRatings.userId, userId), eq(schema.episodeRatings.episodeId, episodeId))
		);
}

export async function clearMovieRating(userId: number, movieId: number): Promise<void> {
	await db
		.delete(schema.movieRatings)
		.where(and(eq(schema.movieRatings.userId, userId), eq(schema.movieRatings.movieId, movieId)));
}

export async function setEpisodeEmotion(
	userId: number,
	episodeId: number,
	emotionId: number
): Promise<void> {
	await db
		.insert(schema.episodeEmotions)
		.values({ userId, episodeId, emotionId })
		.onConflictDoNothing({
			target: [
				schema.episodeEmotions.userId,
				schema.episodeEmotions.episodeId,
				schema.episodeEmotions.emotionId
			]
		});
}

// ── Reads used by routes ────────────────────────────────────────────────────
/** Set of watched episode ids (for a show) so the UI can render checkboxes. */
export async function watchedEpisodeIds(userId: number, showId: number): Promise<Set<number>> {
	const rows = await db
		.select({ episodeId: schema.episodeWatches.episodeId })
		.from(schema.episodeWatches)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
		.where(and(eq(schema.episodeWatches.userId, userId), eq(schema.catalogEpisodes.showId, showId)));
	return new Set(rows.map((r) => r.episodeId));
}

/**
 * Map of episodeId → watch_count (for a show) so the UI can render both the
 * watched state (count > 0) and the "×N" rewatch badge (count > 1). Only rows
 * that exist are returned; unwatched episodes are simply absent.
 */
export async function watchCountsForShow(
	userId: number,
	showId: number
): Promise<Map<number, number>> {
	const rows = await db
		.select({
			episodeId: schema.episodeWatches.episodeId,
			watchCount: schema.episodeWatches.watchCount
		})
		.from(schema.episodeWatches)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
		.where(and(eq(schema.episodeWatches.userId, userId), eq(schema.catalogEpisodes.showId, showId)));
	return new Map(rows.map((r) => [r.episodeId, r.watchCount]));
}

/** Follow row for a show, or null. */
export async function getFollow(userId: number, showId: number) {
	const rows = await db
		.select()
		.from(schema.follows)
		.where(and(eq(schema.follows.userId, userId), eq(schema.follows.showId, showId)))
		.limit(1);
	return rows[0] ?? null;
}

export type UpNextItem = {
	showId: number;
	showName: string;
	posterPath: string | null;
	episodeId: number;
	seasonNumber: number;
	episodeNumber: number;
	name: string | null;
	airDate: string | null;
	runtimeMin: number | null;
	/**
	 * The user's most-recent watch date for this show (MAX over all their
	 * watched episodes of the show). `null` when they've never logged a watch
	 * for it — treated as stale (goes in the "haven't watched in a while" group).
	 */
	lastWatchedAt: Date | null;
};

/**
 * A show whose most-recent watch is older than this many days is considered
 * "stale" and surfaced under "Haven't watched in a while" instead of "Up Next".
 */
export const STALE_AFTER_DAYS = 30;

/**
 * A show whose next unwatched episode aired within this many days is treated as
 * fresh and surfaced under "Up Next" — even if the user last watched it long ago.
 * This keeps just-dropped episodes visible for shows you'd otherwise have let go
 * stale between seasons.
 */
export const RECENT_EPISODE_DAYS = 30;

export type UpNextGroups = {
	/**
	 * Actionable shows: watched within STALE_AFTER_DAYS OR with a next episode that
	 * aired within RECENT_EPISODE_DAYS, freshest first.
	 */
	upNext: UpNextItem[];
	/** Neglected shows (watched long ago / never AND no recent episode), longest-neglected first. */
	stale: UpNextItem[];
};

/**
 * "Up Next" — the next unwatched, already-aired episode for every show the user
 * is actively watching, in ONE set-based query (no N+1, no TMDB calls in the
 * request path; relies on the already-cached catalog, refreshed by a nightly
 * job). `DISTINCT ON (show_id)` + ordering picks the earliest pending episode.
 * Specials (season 0) are excluded, matching markShowWatched.
 *
 * Each row also carries `lastWatchedAt`, the user's most-recent watch date for
 * that show, computed via a single correlated subquery (MAX over that user's
 * watches joined to the show's episodes) — still ONE query overall, no N+1.
 *
 * Results are partitioned into two groups:
 *  - `upNext`: watched within STALE_AFTER_DAYS OR whose next unwatched episode aired
 *              within RECENT_EPISODE_DAYS (a freshly-dropped episode resurfaces a show
 *              even if it was last watched long ago). Ordered by the freshest of
 *              {last watch, next-episode air date} DESC.
 *  - `stale`:  watched long ago / never AND with no recent episode, ordered by
 *              lastWatchedAt ASC (longest-neglected first; `null` = never watched
 *              sorts first as the most neglected).
 */
export async function getUpNext(userId: number): Promise<UpNextGroups> {
	const rows = await db
		.selectDistinctOn([schema.catalogEpisodes.showId], {
			showId: schema.catalogShows.id,
			showName: schema.catalogShows.name,
			posterPath: schema.catalogShows.posterPath,
			episodeId: schema.catalogEpisodes.id,
			seasonNumber: schema.catalogEpisodes.seasonNumber,
			episodeNumber: schema.catalogEpisodes.episodeNumber,
			name: schema.catalogEpisodes.name,
			airDate: schema.catalogEpisodes.airDate,
			runtimeMin: schema.catalogEpisodes.runtimeMin,
			// Correlated subquery: MAX(last_watched_at) over this user's watches for
			// any episode of the current show. Inner tables are aliased (ew_lw/ce_lw)
			// so they don't clash with the outer joins; correlation is on the outer
			// catalog_episodes.show_id. One query — no per-show round-trip (no N+1).
			lastWatchedAt: sql<Date | null>`(
				select max(ew_lw.last_watched_at)
				from episode_watches ew_lw
				inner join catalog_episodes ce_lw on ce_lw.id = ew_lw.episode_id
				where ew_lw.user_id = ${userId}
					and ce_lw.show_id = ${schema.catalogEpisodes.showId}
					and ce_lw.season_number > 0
			)`
		})
		.from(schema.catalogEpisodes)
		.innerJoin(
			schema.follows,
			and(
				eq(schema.follows.showId, schema.catalogEpisodes.showId),
				eq(schema.follows.userId, userId),
				eq(schema.follows.status, 'watching')
			)
		)
		.innerJoin(schema.catalogShows, eq(schema.catalogShows.id, schema.catalogEpisodes.showId))
		.leftJoin(
			schema.episodeWatches,
			and(
				eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id),
				eq(schema.episodeWatches.userId, userId)
			)
		)
		.where(
			and(
				isNull(schema.episodeWatches.id),
				gt(schema.catalogEpisodes.seasonNumber, 0),
				sql`(${schema.catalogEpisodes.airDate} is null or ${schema.catalogEpisodes.airDate} <= now())`
			)
		)
		.orderBy(
			schema.catalogEpisodes.showId,
			schema.catalogEpisodes.seasonNumber,
			schema.catalogEpisodes.episodeNumber
		);

	const now = Date.now();
	// Two independent recency cutoffs.
	const watchCutoff = now - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
	const episodeCutoff = now - RECENT_EPISODE_DAYS * 24 * 60 * 60 * 1000;
	// BOTH lastWatchedAt (raw sql<Date> cast on a correlated subquery) AND airDate (a
	// date column) arrive at runtime as STRINGS, not Date objects — postgres-js only
	// auto-parses some typed selects, and calling .getTime() directly on either throws
	// "getTime is not a function" (this caused a prod 500). Always coerce through ms();
	// new Date() accepts both a Date and an ISO/'YYYY-MM-DD' string.
	const ms = (v: unknown): number | null =>
		v == null ? null : new Date(v as string | Date).getTime();
	const upNext: UpNextItem[] = [];
	const stale: UpNextItem[] = [];
	for (const row of rows) {
		const watchedTs = ms(row.lastWatchedAt);
		const airedTs = ms(row.airDate);
		// Actionable if watched recently OR the next unwatched episode aired recently.
		const watchedRecently = watchedTs !== null && watchedTs >= watchCutoff;
		const airedRecently = airedTs !== null && airedTs >= episodeCutoff;
		if (watchedRecently || airedRecently) upNext.push(row);
		else stale.push(row);
	}

	// Up Next: freshest first. A show floats up on EITHER a recent watch or a
	// just-dropped episode, so rank by the max of the two timestamps.
	const freshness = (r: UpNextItem) => Math.max(ms(r.lastWatchedAt) ?? 0, ms(r.airDate) ?? 0);
	upNext.sort((a, b) => freshness(b) - freshness(a));
	// Stale: longest-neglected first — oldest watch first, never-watched (null) first of all.
	stale.sort((a, b) => (ms(a.lastWatchedAt) ?? 0) - (ms(b.lastWatchedAt) ?? 0));

	return { upNext, stale };
}

export async function ensureShowById(tmdbId: number): Promise<CatalogShow> {
	return ensureShow(tmdbId);
}

/** Map of showId → watched episode count, for the whole library. */
export async function watchedCountsByShow(userId: number): Promise<Map<number, number>> {
	const rows = await db
		.select({
			showId: schema.catalogEpisodes.showId,
			n: sql<number>`count(*)::int`
		})
		.from(schema.episodeWatches)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id))
		.where(eq(schema.episodeWatches.userId, userId))
		.groupBy(schema.catalogEpisodes.showId);
	return new Map(rows.map((r) => [r.showId, r.n]));
}

/** Episode ratings & emotions for a show, keyed by episode id. */
export async function ratingsForShow(userId: number, showId: number) {
	const ratings = await db
		.select({ episodeId: schema.episodeRatings.episodeId, rating: schema.episodeRatings.rating })
		.from(schema.episodeRatings)
		.innerJoin(schema.catalogEpisodes, eq(schema.episodeRatings.episodeId, schema.catalogEpisodes.id))
		.where(and(eq(schema.episodeRatings.userId, userId), eq(schema.catalogEpisodes.showId, showId)));
	return new Map(ratings.map((r) => [r.episodeId, r.rating]));
}

export type MovieLibraryItem = {
	movieId: number;
	title: string;
	posterPath: string | null;
	watchedAt: Date | null;
	watchCount: number;
};

/**
 * The user's watched movies (their movie library), most-recently-watched first.
 * Scoped to `userId` — never returns another user's movies.
 */
export async function getMovieLibrary(userId: number): Promise<MovieLibraryItem[]> {
	return db
		.select({
			movieId: schema.catalogMovies.id,
			title: schema.catalogMovies.title,
			posterPath: schema.catalogMovies.posterPath,
			watchedAt: schema.movieWatches.watchedAt,
			watchCount: schema.movieWatches.watchCount
		})
		.from(schema.movieWatches)
		.innerJoin(schema.catalogMovies, eq(schema.movieWatches.movieId, schema.catalogMovies.id))
		.where(eq(schema.movieWatches.userId, userId))
		.orderBy(desc(schema.movieWatches.watchedAt));
}
