import { error } from '@sveltejs/kit';
import {
	getFollowedShows,
	getUserStats,
	getVisibleProfile,
	getWatchedMovieIds
} from '$lib/server/community';
import { getMovieLibrary } from '$lib/server/library';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const me = locals.user!;
	const targetId = Number(params.id);

	// Only allow comparing against a VISIBLE user (public, or yourself). Private →
	// 404. Never exposes email/password_hash — only names, stats, library titles.
	const profile = await getVisibleProfile(targetId, me.id);
	if (!profile) throw error(404, 'Profile not found');

	const [myStats, theirStats, myShows, theirShows, myMovies, theirMovies, myMovieIds, theirMovieIds] =
		await Promise.all([
			getUserStats(me.id),
			getUserStats(targetId),
			getFollowedShows(me.id),
			getFollowedShows(targetId),
			getMovieLibrary(me.id),
			getMovieLibrary(targetId),
			getWatchedMovieIds(me.id),
			getWatchedMovieIds(targetId)
		]);

	// ── Shared titles (intersections) ──────────────────────────────────────────
	const myShowIds = new Set(myShows.map((s) => s.showId));
	const theirShowIds = new Set(theirShows.map((s) => s.showId));
	const sharedShows = theirShows.filter((s) => myShowIds.has(s.showId));

	const myMovieIdSet = new Set(myMovieIds);
	const theirMovieIdSet = new Set(theirMovieIds);
	const sharedMovies = theirMovies.filter((m) => myMovieIdSet.has(m.movieId));

	/*
	 * ── Taste-match % (Jaccard index) ──────────────────────────────────────────
	 * Build one comparable "taste set" per user over BOTH followed shows AND
	 * watched movies, namespacing ids so a show id can't collide with a movie id:
	 *     tasteSet(u) = { `s:${showId}` } ∪ { `m:${movieId}` }
	 * Taste match = |A ∩ B| / |A ∪ B|  (Jaccard). 1.0 = identical taste, 0 = none.
	 * Undefined for two empty sets → reported as 0%.
	 */
	const mine = new Set<string>([
		...[...myShowIds].map((id) => `s:${id}`),
		...myMovieIds.map((id) => `m:${id}`)
	]);
	const theirs = new Set<string>([
		...[...theirShowIds].map((id) => `s:${id}`),
		...theirMovieIds.map((id) => `m:${id}`)
	]);
	let intersection = 0;
	for (const key of mine) if (theirs.has(key)) intersection++;
	const union = mine.size + theirs.size - intersection;
	const tasteMatch = union === 0 ? 0 : Math.round((intersection / union) * 100);

	// ── "They follow that you don't" — lightweight recommendations ──────────────
	const recommendations = theirShows.filter((s) => !myShowIds.has(s.showId)).slice(0, 12);

	const minutes = (s: typeof myStats) => s?.minutesWatched ?? 0;

	return {
		profile,
		me: {
			displayName: me.displayName ?? 'You',
			minutes: minutes(myStats),
			episodes: myStats?.episodesWatched ?? 0,
			movies: myStats?.moviesWatched ?? 0,
			shows: myStats?.showsFollowed ?? 0
		},
		them: {
			displayName: profile.displayName,
			minutes: minutes(theirStats),
			episodes: theirStats?.episodesWatched ?? 0,
			movies: theirStats?.moviesWatched ?? 0,
			shows: theirStats?.showsFollowed ?? 0
		},
		tasteMatch,
		sharedShows,
		sharedMovies,
		recommendations
	};
};
