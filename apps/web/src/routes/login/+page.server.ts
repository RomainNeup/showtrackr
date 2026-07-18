import { fail, redirect } from '@sveltejs/kit';
import {
	createUser,
	findUserByEmail,
	setSessionCookie,
	userCount,
	verifyPassword
} from '$lib/server/auth';
import { recomputeUserStats } from '$lib/server/stats';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// First run (no user yet) → the form becomes "create account".
	const count = await userCount();
	return { firstRun: count === 0 };
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

		// NOTE (single-user): no login rate-limit / lockout yet. Acceptable for a
		// mono-user self-host; add throttling if this ever goes multi-user.
		const user = await findUserByEmail(email);
		if (!user || !verifyPassword(password, user.passwordHash)) {
			return fail(401, { email, error: 'Invalid email or password.' });
		}

		setSessionCookie(cookies, user.id);
		throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	},

	register: async ({ request, cookies, url }) => {
		// Only allowed on first run — never let a second user self-register.
		if ((await userCount()) > 0) {
			return fail(403, { error: 'An account already exists.' });
		}

		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const displayName = String(form.get('displayName') ?? '').trim();

		if (!email || password.length < 8) {
			return fail(400, {
				email,
				error: 'Email and a password of at least 8 characters are required.'
			});
		}

		const userId = await createUser({ email, password, displayName: displayName || undefined });
		await recomputeUserStats(userId);
		setSessionCookie(cookies, userId);
		throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	}
};
