import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const [profile] = await db
		.select({
			email: schema.users.email,
			displayName: schema.users.displayName,
			isPublic: schema.users.isPublic,
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

export const actions: Actions = {
	// Toggle the instance-visibility of this user's profile (Community feature).
	// The desired next state arrives as `isPublic=on|<absent>` from the switch.
	setVisibility: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const isPublic = form.get('isPublic') === 'on';
		await db
			.update(schema.users)
			.set({ isPublic })
			.where(eq(schema.users.id, user.id));
		return { success: true, isPublic };
	}
};
