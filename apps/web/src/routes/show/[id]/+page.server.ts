import { error, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db, schema, type CatalogShow } from '$lib/server/db';
import { ensureSeasonEpisodes, ensureShow } from '$lib/server/catalog';
import { getShowRecommendations } from '$lib/server/tmdb';
import { getRegionProviders } from '$lib/server/watch-providers';
import {
	addRewatch,
	clearEpisodeRating,
	followShow,
	getFollow,
	markSeasonRewatched,
	markSeasonWatched,
	markShowRewatched,
	markShowWatched,
	rateEpisode,
	ratingsForShow,
	setEpisodeWatched,
	setFavorite,
	setFollowStatus,
	unfollowShow,
	watchCountsForShow
} from '$lib/server/library';
import type { Actions, PageServerLoad } from './$types';
import type { FollowStatus } from '$lib/server/db';

async function loadShow(id: number): Promise<CatalogShow> {
	const rows = await db.select().from(schema.catalogShows).where(eq(schema.catalogShows.id, id)).limit(1);
	if (!rows[0]) throw error(404, 'Show not found');
	return rows[0];
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user!;
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'Invalid show id');

	const show = await loadShow(id);

	const seasonRows = await db
		.select()
		.from(schema.catalogSeasons)
		.where(eq(schema.catalogSeasons.showId, show.id))
		.orderBy(asc(schema.catalogSeasons.seasonNumber));

	const watchCounts = await watchCountsForShow(user.id, show.id);
	const ratings = await ratingsForShow(user.id, show.id);
	const follow = await getFollow(user.id, show.id);

	// Hydrate episodes for each season (cache-through TMDB on first view), in
	// parallel — Promise.all preserves seasonRows order.
	const seasons = await Promise.all(
		seasonRows.map(async (s) => {
			const episodes = await ensureSeasonEpisodes(show, s.seasonNumber);
			return {
				seasonNumber: s.seasonNumber,
				name: s.name ?? `Season ${s.seasonNumber}`,
				episodes: episodes.map((e) => ({
					id: e.id,
					seasonNumber: e.seasonNumber,
					episodeNumber: e.episodeNumber,
					name: e.name ?? `Episode ${e.episodeNumber}`,
					airDate: e.airDate,
					runtimeMin: e.runtimeMin,
					watched: watchCounts.has(e.id),
					watchCount: watchCounts.get(e.id) ?? 0,
					rating: ratings.get(e.id) ?? null
				}))
			};
		})
	);

	// Specials (season 0) are rarely watched and shouldn't head the list — put them
	// last, regular seasons ascending.
	seasons.sort(
		(a, b) =>
			(a.seasonNumber === 0 ? 1 : 0) - (b.seasonNumber === 0 ? 1 : 0) ||
			a.seasonNumber - b.seasonNumber
	);

	// "Where to Watch" providers + "More like this" recommendations, in parallel.
	// Recommendations come straight from TMDB (not yet in our local catalog); we
	// exclude the current show and every show this user already follows.
	const [providers, recommendations] = await Promise.all([
		// "Where to Watch" providers (JustWatch-powered): cache-through the full
		// multi-region TMDB response, then pick the configured region (FR) for display.
		getRegionProviders('show', show.tmdbId),
		(async () => {
			const [recs, followed] = await Promise.all([
				getShowRecommendations(show.tmdbId),
				// USER-SCOPED: tmdbIds of shows this user already follows.
				db
					.select({ tmdbId: schema.catalogShows.tmdbId })
					.from(schema.follows)
					.innerJoin(schema.catalogShows, eq(schema.follows.showId, schema.catalogShows.id))
					.where(eq(schema.follows.userId, user.id))
			]);
			const exclude = new Set<number>([show.tmdbId, ...followed.map((f) => f.tmdbId)]);
			return recs
				.filter((r) => !exclude.has(r.tmdbId))
				.map((r) => ({ tmdbId: r.tmdbId, name: r.name, posterPath: r.posterPath }));
		})()
	]);

	return {
		show: {
			id: show.id,
			name: show.name,
			overview: show.overview,
			posterPath: show.posterPath,
			backdropPath: show.backdropPath,
			status: show.status,
			firstAirDate: show.firstAirDate,
			network: show.network
		},
		seasons,
		providers,
		follow: follow
			? { status: follow.status as FollowStatus, isFavorite: follow.isFavorite }
			: null,
		recommendations
	};
};

const STATUSES: FollowStatus[] = ['watching', 'upcoming', 'stopped', 'archived'];

export const actions: Actions = {
	// Cache a recommended show locally (it's a raw TMDB result) then open its page.
	open: async ({ request, locals }) => {
		if (!locals.user) throw error(401, 'Not authenticated');
		const tmdbId = Number((await request.formData()).get('tmdbId'));
		const show = await ensureShow(tmdbId);
		throw redirect(303, `/show/${show.id}`);
	},

	toggleEpisode: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const episodeId = Number(form.get('episodeId'));
		const watched = form.get('watched') === 'on';
		await setEpisodeWatched(user.id, episodeId, watched);
		return { success: true };
	},

	rewatchEpisode: async ({ request, locals }) => {
		const user = locals.user!;
		const episodeId = Number((await request.formData()).get('episodeId'));
		await addRewatch(user.id, episodeId);
		return { success: true };
	},

	rewatchSeason: async ({ request, params, locals }) => {
		const user = locals.user!;
		const show = await loadShow(Number(params.id));
		const seasonNumber = Number((await request.formData()).get('seasonNumber'));
		await markSeasonRewatched(user.id, show, seasonNumber);
		return { success: true };
	},

	rewatchAll: async ({ params, locals }) => {
		const user = locals.user!;
		const show = await loadShow(Number(params.id));
		await markShowRewatched(user.id, show);
		return { success: true };
	},

	rateEpisode: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const episodeId = Number(form.get('episodeId'));
		const rating = Number(form.get('rating'));
		if (rating > 0) await rateEpisode(user.id, episodeId, rating);
		else await clearEpisodeRating(user.id, episodeId);
		return { success: true };
	},

	markSeason: async ({ request, params, locals }) => {
		const user = locals.user!;
		const show = await loadShow(Number(params.id));
		const seasonNumber = Number((await request.formData()).get('seasonNumber'));
		await markSeasonWatched(user.id, show, seasonNumber);
		return { success: true };
	},

	markAll: async ({ params, locals }) => {
		const user = locals.user!;
		const show = await loadShow(Number(params.id));
		await markShowWatched(user.id, show);
		return { success: true };
	},

	follow: async ({ params, locals }) => {
		const user = locals.user!;
		await followShow(user.id, Number(params.id), 'watching');
		return { success: true };
	},

	unfollow: async ({ params, locals }) => {
		const user = locals.user!;
		await unfollowShow(user.id, Number(params.id));
		return { success: true };
	},

	setStatus: async ({ request, params, locals }) => {
		const user = locals.user!;
		const status = String((await request.formData()).get('status')) as FollowStatus;
		if (!STATUSES.includes(status)) throw error(400, 'Invalid status');
		await setFollowStatus(user.id, Number(params.id), status);
		return { success: true };
	},

	toggleFavorite: async ({ request, params, locals }) => {
		const user = locals.user!;
		const isFavorite = (await request.formData()).get('isFavorite') === 'on';
		await setFavorite(user.id, Number(params.id), isFavorite);
		return { success: true };
	}
};
