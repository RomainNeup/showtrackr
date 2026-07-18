/**
 * Catalog cache-through helpers. We never re-hit TMDB when we already have the
 * data locally (PLAN §7): every fetch upserts into the `catalog_*` tables and
 * subsequent reads come from Postgres.
 *
 * All functions return the local catalog row (with our own bigint `id`), which
 * is what user tables (`follows`, `episode_watches`, …) reference.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema, type CatalogEpisode, type CatalogMovie, type CatalogShow } from './db';
import { getMovie, getSeasonEpisodes, getShow } from './tmdb';

/**
 * Ensure a show (and its season rows) exist locally. If `force` is false and we
 * already have the show cached, return it without calling TMDB.
 */
export async function ensureShow(tmdbId: number, force = false): Promise<CatalogShow> {
	if (!force) {
		const existing = await db
			.select()
			.from(schema.catalogShows)
			.where(eq(schema.catalogShows.tmdbId, tmdbId))
			.limit(1);
		if (existing[0]) return existing[0];
	}

	const show = await getShow(tmdbId);
	const [row] = await db
		.insert(schema.catalogShows)
		.values({
			tmdbId: show.tmdbId,
			name: show.name,
			overview: show.overview,
			posterPath: show.posterPath,
			backdropPath: show.backdropPath,
			status: show.status,
			firstAirDate: show.firstAirDate,
			network: show.network,
			runtimeAvgMin: show.runtimeAvgMin
		})
		.onConflictDoUpdate({
			target: schema.catalogShows.tmdbId,
			set: {
				name: show.name,
				overview: show.overview,
				posterPath: show.posterPath,
				backdropPath: show.backdropPath,
				status: show.status,
				firstAirDate: show.firstAirDate,
				network: show.network,
				runtimeAvgMin: show.runtimeAvgMin
			}
		})
		.returning();

	// Upsert season rows (skip the "Specials" season 0 by default is optional —
	// we keep everything TMDB returns for fidelity).
	for (const se of show.seasons) {
		await db
			.insert(schema.catalogSeasons)
			.values({
				showId: row.id,
				seasonNumber: se.seasonNumber,
				name: se.name,
				episodeCount: se.episodeCount
			})
			.onConflictDoUpdate({
				target: [schema.catalogSeasons.showId, schema.catalogSeasons.seasonNumber],
				set: { name: se.name, episodeCount: se.episodeCount }
			});
	}

	return row;
}

/**
 * Ensure the episodes of a given season exist locally. Returns the local
 * episode rows ordered by episode number.
 */
export async function ensureSeasonEpisodes(
	show: CatalogShow,
	seasonNumber: number,
	force = false
): Promise<CatalogEpisode[]> {
	if (!force) {
		const existing = await db
			.select()
			.from(schema.catalogEpisodes)
			.where(
				and(
					eq(schema.catalogEpisodes.showId, show.id),
					eq(schema.catalogEpisodes.seasonNumber, seasonNumber)
				)
			);
		if (existing.length) return sortEpisodes(existing);
	}

	const episodes = await getSeasonEpisodes(show.tmdbId, seasonNumber);
	for (const e of episodes) {
		await db
			.insert(schema.catalogEpisodes)
			.values({
				showId: show.id,
				seasonNumber: e.seasonNumber,
				episodeNumber: e.episodeNumber,
				name: e.name,
				airDate: e.airDate,
				runtimeMin: e.runtimeMin ?? show.runtimeAvgMin ?? null,
				tmdbId: e.tmdbId
			})
			.onConflictDoUpdate({
				target: [
					schema.catalogEpisodes.showId,
					schema.catalogEpisodes.seasonNumber,
					schema.catalogEpisodes.episodeNumber
				],
				set: {
					name: e.name,
					airDate: e.airDate,
					runtimeMin: e.runtimeMin ?? show.runtimeAvgMin ?? null,
					tmdbId: e.tmdbId
				}
			});
	}

	const rows = await db
		.select()
		.from(schema.catalogEpisodes)
		.where(
			and(
				eq(schema.catalogEpisodes.showId, show.id),
				eq(schema.catalogEpisodes.seasonNumber, seasonNumber)
			)
		);
	return sortEpisodes(rows);
}

/** Ensure a movie exists locally. */
export async function ensureMovie(tmdbId: number, force = false): Promise<CatalogMovie> {
	if (!force) {
		const existing = await db
			.select()
			.from(schema.catalogMovies)
			.where(eq(schema.catalogMovies.tmdbId, tmdbId))
			.limit(1);
		if (existing[0]) return existing[0];
	}

	const movie = await getMovie(tmdbId);
	const [row] = await db
		.insert(schema.catalogMovies)
		.values({
			tmdbId: movie.tmdbId,
			title: movie.title,
			overview: movie.overview,
			posterPath: movie.posterPath,
			runtimeMin: movie.runtimeMin,
			releaseDate: movie.releaseDate
		})
		.onConflictDoUpdate({
			target: schema.catalogMovies.tmdbId,
			set: {
				title: movie.title,
				overview: movie.overview,
				posterPath: movie.posterPath,
				runtimeMin: movie.runtimeMin,
				releaseDate: movie.releaseDate
			}
		})
		.returning();

	return row;
}

function sortEpisodes(rows: CatalogEpisode[]): CatalogEpisode[] {
	return [...rows].sort((a, b) => a.episodeNumber - b.episodeNumber);
}
