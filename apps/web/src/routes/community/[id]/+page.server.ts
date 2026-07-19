import { error } from '@sveltejs/kit';
import { getFollowedShows, getVisibleProfile } from '$lib/server/community';
import { getMovieLibrary } from '$lib/server/library';
import { getStatsBreakdown } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!;
	const targetId = Number(params.id);

	// Visibility guard: a private target that isn't the viewer → 404 (so private
	// accounts aren't even enumerable). NEVER exposes email/password_hash.
	const profile = await getVisibleProfile(targetId, user.id);
	if (!profile) throw error(404, 'Profile not found');

	const [stats, shows, movies] = await Promise.all([
		getStatsBreakdown(targetId),
		getFollowedShows(targetId),
		getMovieLibrary(targetId)
	]);

	return { profile, stats, shows, movies };
};
