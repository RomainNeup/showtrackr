import { env } from '$env/dynamic/private';
import * as jobs from '$lib/server/import/jobs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	await jobs.reconcileStaleJobsOnce();
	const job = await jobs.getLatestJob(user.id);
	return {
		job,
		// So the UI can warn up-front instead of only failing mid-import.
		tmdbConfigured: !!env.TMDB_API_KEY
	};
};
