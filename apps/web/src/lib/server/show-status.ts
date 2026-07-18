/**
 * TV Time-style "show status color" for the Library grid.
 *
 * Each followed show is coloured by whether the user is caught up on its
 * already-aired episodes, combined with the show's production status:
 *   - 🟡 yellow  → at least one aired, unwatched episode ("watching, not finished")
 *   - 🟢 green   → caught up AND the show is still running
 *   - 🟣 purple  → caught up AND the show has ended/been cancelled
 *   - ⚪ neutral → status unknown (TMDB resolution failed) or no aired episodes yet
 *
 * The colour is derived in TS by `classifyShowColor` (a pure function, trivially
 * unit-testable) from a single grouped query — no N+1, no per-show round-trips.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';

export type ShowColor = 'yellow' | 'green' | 'purple' | 'neutral';

/** Production statuses that mean the show will get no further episodes. */
const ENDED_STATUSES = new Set(['Ended', 'Canceled']);

/** Per-show inputs to the classifier, as returned by the grouped query. */
export type ShowStatusRow = {
	status: string | null;
	/** COUNT of season>0 episodes whose air_date <= now() (i.e. already aired). */
	airedCount: number;
	/** How many of those aired episodes are in the user's episode_watches. */
	watchedAiredCount: number;
};

/**
 * Pure classification of a single show into its Library colour. Order matters:
 * unknown metadata and empty catalogs stay neutral (we never invent a colour);
 * an aired-unwatched backlog wins over everything (yellow); otherwise the
 * production status splits caught-up shows into green (running) vs purple (ended).
 */
export function classifyShowColor(row: ShowStatusRow): ShowColor {
	const { status, airedCount, watchedAiredCount } = row;

	// TMDB resolution failed (null/empty status) → don't force a colour.
	if (status == null || status === '') return 'neutral';
	// Nothing has aired yet → nothing to be behind on.
	if (airedCount === 0) return 'neutral';
	// Behind: at least one aired episode not yet watched → still watching.
	if (watchedAiredCount < airedCount) return 'yellow';
	// Caught up: ended/cancelled → purple, still running → green.
	return ENDED_STATUSES.has(status) ? 'purple' : 'green';
}

/**
 * ONE grouped query over follows → catalog_shows → catalog_episodes →
 * episode_watches (both episode joins are LEFT so shows with 0 episodes and
 * unwatched episodes are preserved), returning per-show
 * {status, airedCount, watchedAiredCount}. Classification happens in TS.
 *
 * Returns a Map keyed by showId so the caller can zip it onto the library rows.
 */
export async function showColorsByUser(userId: number): Promise<Map<number, ShowColor>> {
	const rows = await db
		.select({
			showId: schema.catalogShows.id,
			status: schema.catalogShows.status,
			// Aired episodes (real seasons only, air_date already passed). A NULL
			// air_date is NOT counted as aired (`null <= now()` is NULL → excluded),
			// matching the feature's "air_date <= now()" definition.
			airedCount: sql<number>`count(*) filter (
				where ${schema.catalogEpisodes.seasonNumber} > 0
					and ${schema.catalogEpisodes.airDate} <= now()
			)::int`,
			// Of those aired episodes, how many the user has watched.
			watchedAiredCount: sql<number>`count(*) filter (
				where ${schema.catalogEpisodes.seasonNumber} > 0
					and ${schema.catalogEpisodes.airDate} <= now()
					and ${schema.episodeWatches.id} is not null
			)::int`
		})
		.from(schema.follows)
		.innerJoin(schema.catalogShows, eq(schema.catalogShows.id, schema.follows.showId))
		.leftJoin(schema.catalogEpisodes, eq(schema.catalogEpisodes.showId, schema.catalogShows.id))
		.leftJoin(
			schema.episodeWatches,
			and(
				eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id),
				eq(schema.episodeWatches.userId, userId)
			)
		)
		.where(eq(schema.follows.userId, userId))
		.groupBy(schema.catalogShows.id, schema.catalogShows.status);

	return new Map(rows.map((r) => [r.showId, classifyShowColor(r)]));
}
