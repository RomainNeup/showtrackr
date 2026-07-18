import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema, type FollowStatus } from '$lib/server/db';
import { setFavorite, setFollowStatus, watchedCountsByShow } from '$lib/server/library';
import { showColorsByUser } from '$lib/server/show-status';
import type { Actions, PageServerLoad } from './$types';

const STATUSES: FollowStatus[] = ['watching', 'upcoming', 'stopped', 'archived'];

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const rows = await db
		.select()
		.from(schema.follows)
		.innerJoin(schema.catalogShows, eq(schema.follows.showId, schema.catalogShows.id))
		.where(eq(schema.follows.userId, user.id));

	const [watchedCounts, colors] = await Promise.all([
		watchedCountsByShow(user.id),
		showColorsByUser(user.id)
	]);

	const shows = rows.map((r) => ({
		showId: r.catalog_shows.id,
		name: r.catalog_shows.name,
		posterPath: r.catalog_shows.posterPath,
		status: r.follows.status as FollowStatus,
		isFavorite: r.follows.isFavorite,
		watchedEpisodes: watchedCounts.get(r.catalog_shows.id) ?? 0,
		// TV Time-style status colour derived from aired-vs-watched + show status.
		color: colors.get(r.catalog_shows.id) ?? 'neutral'
	}));

	return { shows, statuses: STATUSES };
};

export const actions: Actions = {
	setStatus: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw error(401, 'Not authenticated');
		const form = await request.formData();
		const showId = Number(form.get('showId'));
		const status = String(form.get('status')) as FollowStatus;
		if (!STATUSES.includes(status)) throw error(400, 'Invalid status');
		await setFollowStatus(user.id, showId, status);
		return { success: true };
	},

	toggleFavorite: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw error(401, 'Not authenticated');
		const form = await request.formData();
		const showId = Number(form.get('showId'));
		const isFavorite = form.get('isFavorite') === 'on';
		await setFavorite(user.id, showId, isFavorite);
		return { success: true };
	}
};
