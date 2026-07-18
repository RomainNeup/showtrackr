/**
 * TMDB API client (server-only). Endpoints match CONTRACT.md so the Importer
 * agent can reuse the same surface:
 *   findByTvdbId, getShow, getSeasonEpisodes, getMovie, searchMulti
 *
 * TMDB v3 REST API, authenticated with an API key from the environment.
 * A small retry/backoff wrapper handles 429 rate-limiting (see PLAN §7).
 */
import { env } from '$env/dynamic/private';

const BASE = 'https://api.themoviedb.org/3';

/**
 * Region for "Where to Watch" streaming providers. TMDB's watch/providers data
 * (powered by JustWatch) is keyed per-country, so we MUST pick one. The user is
 * in France → default to 'FR'. Overridable via env (WATCH_REGION) without a code
 * change; with no env set it stays FR. This is the single source of the default.
 */
export const WATCH_REGION = env.WATCH_REGION ?? 'FR';

// Re-export the client-safe image helper for server callers that want it.
export { tmdbImage } from '$lib/tmdb-image';

// ── Normalised return shapes (what the rest of the app consumes) ────────────
export type TmdbFindResult = { tmdbId: number; type: 'tv' | 'movie' };

export type TmdbShow = {
	tmdbId: number;
	name: string;
	overview: string | null;
	posterPath: string | null;
	backdropPath: string | null;
	status: string | null;
	firstAirDate: string | null;
	network: string | null;
	runtimeAvgMin: number | null;
	seasons: Array<{ seasonNumber: number; name: string; episodeCount: number }>;
};

export type TmdbEpisode = {
	seasonNumber: number;
	episodeNumber: number;
	name: string;
	airDate: string | null;
	runtimeMin: number | null;
	tmdbId: number | null;
};

export type TmdbMovie = {
	tmdbId: number;
	title: string;
	overview: string | null;
	posterPath: string | null;
	runtimeMin: number | null;
	releaseDate: string | null;
};

/** Raw TMDB provider entry (as returned inside each country's group). */
export type TmdbRawProvider = {
	provider_id: number;
	provider_name: string;
	logo_path: string | null;
	display_priority: number;
};

/** Raw per-country group from TMDB watch/providers. */
export type TmdbWatchRegion = {
	link?: string;
	flatrate?: TmdbRawProvider[];
	rent?: TmdbRawProvider[];
	buy?: TmdbRawProvider[];
	free?: TmdbRawProvider[];
	ads?: TmdbRawProvider[];
};

/**
 * Full TMDB `results` object: one entry per ISO country code. This is what we
 * store verbatim in `catalog_watch_providers.results` (all regions in one shot).
 */
export type TmdbWatchResults = Record<string, TmdbWatchRegion>;

/** A single streaming provider, normalised for the UI. */
export type WatchProvider = { id: number; name: string; logoPath: string | null };

/** Normalised watch-provider result for one selected region. */
export type WatchProviders = {
	region: string;
	link: string | null;
	flatrate: WatchProvider[];
	rent: WatchProvider[];
	buy: WatchProvider[];
};

export type TmdbSearchItem =
	| { type: 'show'; tmdbId: number; title: string; posterPath: string | null; year: string | null; overview: string | null }
	| { type: 'movie'; tmdbId: number; title: string; posterPath: string | null; year: string | null; overview: string | null };

// ── Low-level fetch with API key + backoff ──────────────────────────────────
async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
	const key = env.TMDB_API_KEY;
	if (!key) throw new Error('TMDB_API_KEY is not set.');

	// TMDB accepts either a v3 API key (32-char hex, sent as ?api_key=) or a v4
	// Read Access Token (a long JWT, sent as `Authorization: Bearer`). Detect which.
	const isV4Token = key.length > 40 || key.includes('.');

	const url = new URL(`${BASE}${path}`);
	if (!isV4Token) url.searchParams.set('api_key', key);
	url.searchParams.set('language', 'en-US');
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	const headers: Record<string, string> = { accept: 'application/json' };
	if (isV4Token) headers.authorization = `Bearer ${key}`;

	let attempt = 0;
	// Retry on 429 (rate limit) and transient 5xx with capped exponential backoff.
	while (true) {
		const res = await fetch(url, { headers });
		if (res.ok) return (await res.json()) as T;

		if ((res.status === 429 || res.status >= 500) && attempt < 4) {
			const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
			await new Promise((r) => setTimeout(r, retryAfter * 1000));
			attempt++;
			continue;
		}
		throw new Error(`TMDB ${path} failed: ${res.status} ${res.statusText}`);
	}
}

// ── Public client (matches CONTRACT) ────────────────────────────────────────

/** Resolve a TheTVDB id → TMDB id + media type via /find. */
export async function findByTvdbId(tvdbId: number | string): Promise<TmdbFindResult | null> {
	const data = await tmdbFetch<{
		tv_results: Array<{ id: number }>;
		movie_results: Array<{ id: number }>;
	}>(`/find/${tvdbId}`, { external_source: 'tvdb_id' });

	if (data.tv_results?.[0]) return { tmdbId: data.tv_results[0].id, type: 'tv' };
	if (data.movie_results?.[0]) return { tmdbId: data.movie_results[0].id, type: 'movie' };
	return null;
}

export async function getShow(tmdbId: number): Promise<TmdbShow> {
	const s = await tmdbFetch<{
		id: number;
		name: string;
		overview: string;
		poster_path: string | null;
		backdrop_path: string | null;
		status: string | null;
		first_air_date: string | null;
		networks?: Array<{ name: string }>;
		episode_run_time?: number[];
		seasons?: Array<{ season_number: number; name: string; episode_count: number }>;
	}>(`/tv/${tmdbId}`);

	const runtimes = s.episode_run_time ?? [];
	return {
		tmdbId: s.id,
		name: s.name,
		overview: s.overview || null,
		posterPath: s.poster_path,
		backdropPath: s.backdrop_path,
		status: s.status,
		firstAirDate: s.first_air_date || null,
		network: s.networks?.[0]?.name ?? null,
		runtimeAvgMin: runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : null,
		seasons: (s.seasons ?? []).map((se) => ({
			seasonNumber: se.season_number,
			name: se.name,
			episodeCount: se.episode_count
		}))
	};
}

export async function getSeasonEpisodes(tmdbId: number, season: number): Promise<TmdbEpisode[]> {
	const data = await tmdbFetch<{
		episodes?: Array<{
			id: number;
			season_number: number;
			episode_number: number;
			name: string;
			air_date: string | null;
			runtime: number | null;
		}>;
	}>(`/tv/${tmdbId}/season/${season}`);

	return (data.episodes ?? []).map((e) => ({
		seasonNumber: e.season_number,
		episodeNumber: e.episode_number,
		name: e.name,
		airDate: e.air_date || null,
		runtimeMin: e.runtime ?? null,
		tmdbId: e.id
	}));
}

export async function getMovie(tmdbId: number): Promise<TmdbMovie> {
	const m = await tmdbFetch<{
		id: number;
		title: string;
		overview: string;
		poster_path: string | null;
		runtime: number | null;
		release_date: string | null;
	}>(`/movie/${tmdbId}`);

	return {
		tmdbId: m.id,
		title: m.title,
		overview: m.overview || null,
		posterPath: m.poster_path,
		runtimeMin: m.runtime ?? null,
		releaseDate: m.release_date || null
	};
}

/**
 * Fetch "Where to Watch" streaming providers for a show/movie. A single TMDB
 * call returns ALL countries, so we return the FULL `results` object (keyed by
 * ISO country code) — the caller stores it verbatim and picks a region at read
 * time. Data is powered by JustWatch (attribution required by TMDB's terms).
 */
export async function getWatchProviders(
	kind: 'tv' | 'movie',
	tmdbId: number
): Promise<TmdbWatchResults> {
	const data = await tmdbFetch<{ id: number; results?: TmdbWatchResults }>(
		`/${kind}/${tmdbId}/watch/providers`
	);
	return data.results ?? {};
}

/**
 * Pick a single region out of a stored full `results` object and normalise it
 * for the UI. Defaults to the configured WATCH_REGION (FR). If the region key is
 * absent we return empty groups (NOT a silent US fallback), so the UI can show a
 * clean "not available in {region}" empty state.
 */
export function selectRegionProviders(
	results: TmdbWatchResults | null | undefined,
	region: string = WATCH_REGION
): WatchProviders {
	const group = results?.[region];
	if (!group) {
		return { region, link: null, flatrate: [], rent: [], buy: [] };
	}

	// Sort by TMDB's display_priority (lower = shown first) then normalise.
	const normalise = (list: TmdbRawProvider[] | undefined): WatchProvider[] =>
		(list ?? [])
			.slice()
			.sort((a, b) => a.display_priority - b.display_priority)
			.map((p) => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path }));

	// Fold free + ad-supported providers into the "stream" (flatrate) group, keeping
	// it simple: they're all ways to stream without paying per title. De-dupe by id.
	const streamRaw = [...(group.flatrate ?? []), ...(group.free ?? []), ...(group.ads ?? [])];
	const seen = new Set<number>();
	const flatrate = normalise(streamRaw).filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));

	return {
		region,
		link: group.link ?? null,
		flatrate,
		rent: normalise(group.rent),
		buy: normalise(group.buy)
	};
}

export async function searchMulti(query: string): Promise<TmdbSearchItem[]> {
	const q = query.trim();
	if (!q) return [];
	const data = await tmdbFetch<{
		results: Array<{
			id: number;
			media_type: 'tv' | 'movie' | 'person';
			name?: string;
			title?: string;
			poster_path: string | null;
			first_air_date?: string;
			release_date?: string;
			overview?: string;
		}>;
	}>(`/search/multi`, { query: q, include_adult: 'false' });

	return (data.results ?? [])
		.filter((r) => r.media_type === 'tv' || r.media_type === 'movie')
		.map((r): TmdbSearchItem => {
			const date = r.first_air_date || r.release_date || '';
			const common = {
				tmdbId: r.id,
				title: r.name ?? r.title ?? 'Untitled',
				posterPath: r.poster_path,
				year: date ? date.slice(0, 4) : null,
				overview: r.overview || null
			};
			return r.media_type === 'tv' ? { type: 'show', ...common } : { type: 'movie', ...common };
		});
}
