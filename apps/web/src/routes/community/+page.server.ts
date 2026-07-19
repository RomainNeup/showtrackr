import { listVisibleMembers } from '$lib/server/community';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const members = await listVisibleMembers(user.id);

	// Directory ordering: put the viewer first, then most hours watched.
	members.sort((a, b) => {
		if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
		return b.minutesWatched - a.minutesWatched;
	});

	return { members };
};
