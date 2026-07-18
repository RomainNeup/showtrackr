import { fail, redirect } from '@sveltejs/kit';
import {
	findUserByEmail,
	isRegistrationOpen,
	setSessionCookie,
	userCount,
	verifyPassword
} from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// Fresh install (no account yet) → send the first visitor straight to the
	// create-account screen, preserving the original first-run onboarding UX.
	if (url.searchParams.get('redirectTo') === null && (await userCount()) === 0) {
		throw redirect(303, '/register');
	}
	return { canRegister: await isRegistrationOpen() };
};

function safeRedirect(target: string | null): string {
	// Prevent open-redirects: only allow same-site absolute paths. Reject
	// protocol-relative "//host", and any backslash or ASCII control char — a
	// backslash lets "/\evil.com" normalise to "//evil.com" in browsers.
	if (!target || !target.startsWith('/') || target.startsWith('//')) return '/';
	for (const ch of target) {
		const code = ch.charCodeAt(0);
		if (ch === '\\' || code <= 0x1f) return '/';
	}
	return target;
}

export const actions: Actions = {
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { email, error: 'Email and password are required.' });
		}

		// NOTE: no login rate-limit / lockout yet. Fine for a small self-host;
		// add throttling if the instance is exposed to the open internet.
		const user = await findUserByEmail(email);
		if (!user || !verifyPassword(password, user.passwordHash)) {
			return fail(401, { email, error: 'Invalid email or password.' });
		}

		// Re-issue the cookie with THIS user's uid — fully replaces any prior
		// session, so switching accounts is a clean login (no stale scope).
		setSessionCookie(cookies, user.id);
		throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	}
};
