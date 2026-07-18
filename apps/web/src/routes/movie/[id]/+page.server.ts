import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { addMovieRewatch, clearMovieRating, rateMovie, setMovieWatched } from '$lib/server/library';
import { getRegionProviders } from '$lib/server/watch-providers';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user!;
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'Invalid movie id');

	const rows = await db
		.select()
		.from(schema.catalogMovies)
		.where(eq(schema.catalogMovies.id, id))
		.limit(1);
	const movie = rows[0];
	if (!movie) throw error(404, 'Movie not found');

	const [watch] = await db
		.select()
		.from(schema.movieWatches)
		.where(and(eq(schema.movieWatches.userId, user.id), eq(schema.movieWatches.movieId, id)))
		.limit(1);

	const [rating] = await db
		.select({ rating: schema.movieRatings.rating })
		.from(schema.movieRatings)
		.where(and(eq(schema.movieRatings.userId, user.id), eq(schema.movieRatings.movieId, id)))
		.limit(1);

	// "Where to Watch" providers (JustWatch-powered): cache-through the full
	// multi-region TMDB response, then pick the configured region (FR) for display.
	const providers = await getRegionProviders('movie', movie.tmdbId);

	return {
		movie: {
			id: movie.id,
			title: movie.title,
			overview: movie.overview,
			posterPath: movie.posterPath,
			runtimeMin: movie.runtimeMin,
			releaseDate: movie.releaseDate
		},
		watched: !!watch,
		watchCount: watch?.watchCount ?? 0,
		rating: rating?.rating ?? null,
		providers
	};
};

export const actions: Actions = {
	toggleWatched: async ({ request, params, locals }) => {
		const user = locals.user!;
		const watched = (await request.formData()).get('watched') === 'on';
		await setMovieWatched(user.id, Number(params.id), watched);
		return { success: true };
	},

	rewatch: async ({ params, locals }) => {
		const user = locals.user!;
		await addMovieRewatch(user.id, Number(params.id));
		return { success: true };
	},

	rate: async ({ request, params, locals }) => {
		const user = locals.user!;
		const rating = Number((await request.formData()).get('rating'));
		if (rating > 0) await rateMovie(user.id, Number(params.id), rating);
		else await clearMovieRating(user.id, Number(params.id));
		return { success: true };
	}
};
