import { redirect } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// POST /logout — clears the session cookie and returns to the login screen.
export const POST: RequestHandler = ({ cookies }) => {
	clearSessionCookie(cookies);
	throw redirect(303, '/login');
};
