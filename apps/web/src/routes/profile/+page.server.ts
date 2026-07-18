import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const [profile] = await db
		.select({
			email: schema.users.email,
			displayName: schema.users.displayName,
			timezone: schema.users.timezone,
			language: schema.users.language,
			createdAt: schema.users.createdAt
		})
		.from(schema.users)
		.where(eq(schema.users.id, user.id))
		.limit(1);

	const [stats] = await db
		.select()
		.from(schema.userStats)
		.where(eq(schema.userStats.userId, user.id))
		.limit(1);

	return { profile, stats: stats ?? null };
};
