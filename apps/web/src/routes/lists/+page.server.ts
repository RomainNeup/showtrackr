import { eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	// User's custom lists with item counts.
	const lists = await db
		.select({
			id: schema.lists.id,
			name: schema.lists.name,
			slug: schema.lists.slug,
			type: schema.lists.type,
			isPublic: schema.lists.isPublic,
			itemCount: sql<number>`count(${schema.listItems.id})::int`
		})
		.from(schema.lists)
		.leftJoin(schema.listItems, eq(schema.listItems.listId, schema.lists.id))
		.where(eq(schema.lists.userId, user.id))
		.groupBy(schema.lists.id);

	// Favorite shows (surfaced as a built-in list).
	const favorites = await db
		.select({
			showId: schema.catalogShows.id,
			name: schema.catalogShows.name,
			posterPath: schema.catalogShows.posterPath
		})
		.from(schema.follows)
		.innerJoin(schema.catalogShows, eq(schema.follows.showId, schema.catalogShows.id))
		.where(sql`${schema.follows.userId} = ${user.id} and ${schema.follows.isFavorite} = true`);

	return { lists, favorites };
};
