/**
 * Auth guard. Resolves the current user from the session cookie into
 * `event.locals.user`, then enforces access:
 *  - unauthenticated → redirected to /login (except the login route itself)
 *  - authenticated on /login → redirected to the app home
 *
 * hooks.server.ts must not throw for expected control-flow; `redirect()` is a
 * thrown signal SvelteKit handles, which is the sanctioned pattern here.
 */
import { redirect, type Handle } from '@sveltejs/kit';
import { resolveUser } from '$lib/server/auth';

const PUBLIC_ROUTES = new Set(['/login']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await resolveUser(event.cookies);

	const path = event.url.pathname;
	const isPublic = PUBLIC_ROUTES.has(path);

	if (!event.locals.user && !isPublic) {
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(path)}`);
	}
	if (event.locals.user && path === '/login') {
		throw redirect(303, '/');
	}

	return resolve(event);
};
