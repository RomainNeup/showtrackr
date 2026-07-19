import { getLeaderboard } from '$lib/server/community';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const entries = await getLeaderboard(user.id);
	return { entries };
};
