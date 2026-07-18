import type { LayoutServerLoad } from './$types';

// Expose the authenticated user to every page (devalue-serialisable plain object).
export const load: LayoutServerLoad = async ({ locals }) => {
	return { user: locals.user };
};
