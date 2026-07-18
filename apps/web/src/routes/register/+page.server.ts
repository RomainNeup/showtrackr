import { fail, redirect } from '@sveltejs/kit';
import {
	createUser,
	findUserByEmail,
	isRegistrationOpen,
	setSessionCookie
} from '$lib/server/auth';
import { recomputeUserStats } from '$lib/server/stats';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// When registration is closed (flag off AND at least one account exists),
	// render a clear "registration is closed" state instead of the form.
	return { open: await isRegistrationOpen() };
};

function safeRedirect(target: string | null): string {
	// Prevent open-redirects: only allow same-site absolute paths (see /login).
	if (!target || !target.startsWith('/') || target.startsWith('//')) return '/';
	for (const ch of target) {
		const code = ch.charCodeAt(0);
		if (ch === '\\' || code <= 0x1f) return '/';
	}
	return target;
}

export const actions: Actions = {
	register: async ({ request, cookies, url }) => {
		// Re-check server-side: never trust the rendered form. The bootstrap
		// exception (first account) is baked into isRegistrationOpen().
		if (!(await isRegistrationOpen())) {
			return fail(403, { error: 'Registration is closed on this instance.' });
		}

		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(form.get('password') ?? '');
		const displayName = String(form.get('displayName') ?? '').trim();

		if (!email || password.length < 8) {
			return fail(400, {
				email,
				error: 'Email and a password of at least 8 characters are required.'
			});
		}

		// Reject a duplicate email up front for a clean message (the users.email
		// unique constraint would otherwise surface as a raw 500).
		if (await findUserByEmail(email)) {
			return fail(409, { email, error: 'An account with this email already exists.' });
		}

		const userId = await createUser({ email, password, displayName: displayName || undefined });
		await recomputeUserStats(userId);
		// Log the new account straight in — cookie carries only this uid.
		setSessionCookie(cookies, userId);
		throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	}
};
