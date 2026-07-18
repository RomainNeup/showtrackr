import { error, fail } from '@sveltejs/kit';
import { getUpNext, setEpisodeWatched, type UpNextItem } from '$lib/server/library';
import type { Actions, PageServerLoad } from './$types';

// "Up Next": the next unwatched (already-aired) episode for each show the user
// is actively watching (PLAN §6). Computed in a single set-based SQL query —
// no N+1, no TMDB calls in the request path (catalog is pre-cached). The result
// is split into two groups: actionable — watched recently OR with a freshly-aired
// next episode ("Up Next") — vs neglected ("Haven't watched in a while").
// See getUpNext / STALE_AFTER_DAYS / RECENT_EPISODE_DAYS.
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // guaranteed by hooks

	const toItem = (r: UpNextItem) => ({
		show: { id: r.showId, name: r.showName, posterPath: r.posterPath },
		episode: {
			id: r.episodeId,
			seasonNumber: r.seasonNumber,
			episodeNumber: r.episodeNumber,
			name: r.name ?? `Episode ${r.episodeNumber}`,
			airDate: r.airDate,
			runtimeMin: r.runtimeMin
		}
		// lastWatchedAt is intentionally NOT shipped: partitioning/sorting is done
		// server-side in getUpNext, and the page never renders the date.
	});

	const { upNext, stale } = await getUpNext(user.id);

	return { upNext: upNext.map(toItem), stale: stale.map(toItem) };
};

export const actions: Actions = {
	// Mark the surfaced "up next" episode watched straight from the home card.
	markWatched: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw error(401, 'Not authenticated');

		const form = await request.formData();
		const episodeId = Number(form.get('episodeId'));
		if (!Number.isFinite(episodeId)) return fail(400, { error: 'Invalid episode.' });

		await setEpisodeWatched(user.id, episodeId, true);
		return { success: true };
	}
};
