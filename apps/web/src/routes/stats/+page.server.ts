import { getStatsBreakdown, recomputeUserStats } from '$lib/server/stats';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const stats = await getStatsBreakdown(user.id);
	return { stats };
};

export const actions: Actions = {
	// Force a recompute of the persisted aggregate (e.g. after a bulk import).
	recompute: async ({ locals }) => {
		const user = locals.user!;
		await recomputeUserStats(user.id);
		return { success: true };
	}
};
