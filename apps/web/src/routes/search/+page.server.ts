import { error, redirect } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { searchMulti } from '$lib/server/tmdb';
import { ensureMovie, ensureShow } from '$lib/server/catalog';
import { followShow } from '$lib/server/library';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) return { q, results: [], followedTmdbIds: [] as number[] };

	const results = await searchMulti(q);

	// Mark shows the user already follows (by TMDB id) so the UI can reflect it.
	const showTmdbIds = results.filter((r) => r.type === 'show').map((r) => r.tmdbId);
	let followedTmdbIds: number[] = [];
	if (showTmdbIds.length) {
		const cached = await db
			.select({ tmdbId: schema.catalogShows.tmdbId, id: schema.catalogShows.id })
			.from(schema.catalogShows)
			.where(inArray(schema.catalogShows.tmdbId, showTmdbIds));
		const cachedIds = cached.map((c) => c.id);
		if (cachedIds.length) {
			const follows = await db
				.select({ showId: schema.follows.showId })
				.from(schema.follows)
				.where(inArray(schema.follows.showId, cachedIds));
			const followedLocalIds = new Set(follows.map((f) => f.showId));
			followedTmdbIds = cached.filter((c) => followedLocalIds.has(c.id)).map((c) => c.tmdbId);
		}
	}

	return { q, results, followedTmdbIds };
};

export const actions: Actions = {
	// Cache the show locally and open its page (browse without following).
	open: async ({ request, locals }) => {
		if (!locals.user) throw error(401, 'Not authenticated');
		const tmdbId = Number((await request.formData()).get('tmdbId'));
		const show = await ensureShow(tmdbId);
		throw redirect(303, `/show/${show.id}`);
	},

	// Cache + follow the show, then open its page.
	follow: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw error(401, 'Not authenticated');
		const tmdbId = Number((await request.formData()).get('tmdbId'));
		const show = await ensureShow(tmdbId);
		await followShow(user.id, show.id, 'watching');
		throw redirect(303, `/show/${show.id}`);
	},

	// Cache the movie locally and open its page.
	openMovie: async ({ request, locals }) => {
		if (!locals.user) throw error(401, 'Not authenticated');
		const tmdbId = Number((await request.formData()).get('tmdbId'));
		const movie = await ensureMovie(tmdbId);
		throw redirect(303, `/movie/${movie.id}`);
	}
};
