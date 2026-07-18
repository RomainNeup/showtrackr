/**
 * "Where to Watch" cache-through helper (JustWatch-powered TMDB data).
 *
 * A single TMDB `watch/providers` call returns ALL countries, so we store the
 * FULL `results` object (keyed by ISO country code) in `catalog_watch_providers`
 * and reuse it across views AND regions. Switching region later is just picking
 * another key — no new API call.
 *
 * Kept in its own module (not library.ts / catalog.ts) to avoid edit collisions.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import {
	getWatchProviders,
	selectRegionProviders,
	type TmdbWatchResults,
	type WatchProviders
} from './tmdb';

/** How long a stored row stays fresh before we re-fetch TMDB. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * The catalog kind: `catalog_watch_providers.kind` is `('show' | 'movie')` (see
 * the schema.ts enum). The TMDB watch/providers endpoint uses `'tv'` for shows,
 * so we map `'show' → 'tv'` when building the API path (`tmdbPath` below).
 */
type Kind = 'show' | 'movie';

/** Map our catalog kind to the TMDB endpoint segment ('tv' for shows). */
function tmdbPathKind(kind: Kind): 'tv' | 'movie' {
	return kind === 'show' ? 'tv' : 'movie';
}

/**
 * Return the region-scoped (FR by default) normalised providers for a title,
 * cache-through the stored full multi-region response:
 *  - fresh local row (`fetchedAt` within TTL) → use it, no TMDB call;
 *  - otherwise → fetch full results from TMDB, UPSERT (never delete), use them.
 *
 * `kind` is the catalog kind ('show' | 'movie') — the same values stored in the
 * table's `kind` column — so both detail loads call this symmetrically.
 *
 * On any TMDB failure we return an empty WatchProviders so the page never crashes.
 */
export async function getRegionProviders(kind: Kind, tmdbId: number): Promise<WatchProviders> {
	try {
		const [existing] = await db
			.select()
			.from(schema.catalogWatchProviders)
			.where(
				and(
					eq(schema.catalogWatchProviders.kind, kind),
					eq(schema.catalogWatchProviders.tmdbId, tmdbId)
				)
			)
			.limit(1);

		// `fetchedAt` (timestamptz) may come back as a string or Date depending on
		// the driver — coerce via `new Date(...)` before comparing, never assume Date.
		const isFresh =
			existing && Date.now() - new Date(existing.fetchedAt).getTime() < TTL_MS;
		if (isFresh) {
			return selectRegionProviders(existing.results as TmdbWatchResults);
		}

		const results = await getWatchProviders(tmdbPathKind(kind), tmdbId);

		await db
			.insert(schema.catalogWatchProviders)
			.values({ kind, tmdbId, results, fetchedAt: new Date() })
			.onConflictDoUpdate({
				target: [schema.catalogWatchProviders.kind, schema.catalogWatchProviders.tmdbId],
				set: { results, fetchedAt: new Date() }
			});

		return selectRegionProviders(results);
	} catch {
		// TMDB unreachable (and no fresh cache): degrade to an empty region result
		// rather than failing the whole detail page.
		return selectRegionProviders(null);
	}
}
