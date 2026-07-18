/**
 * Single-user session-cookie auth (PLAN §3, "Lucia-style maison").
 *
 * Design (documented simple approach, no external auth dependency):
 *  - Passwords are hashed with Node's `scrypt` and stored as
 *    `scrypt$<saltHex>$<hashHex>` in `users.password_hash`.
 *  - Sessions are STATELESS: the schema has no `sessions` table (see CONTRACT),
 *    so the cookie carries an HMAC-SHA256-signed payload `{uid, exp}`. The
 *    signature (keyed by SESSION_SECRET) makes it tamper-proof; expiry bounds
 *    its lifetime. No server-side session store needed for a mono-user app.
 *
 * The schema stays multi-user-ready (`user_id` everywhere); this module just
 * resolves "the current user" from the cookie.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from './db';

export type SessionUser = {
	id: number;
	email: string;
	displayName: string | null;
};

export const SESSION_COOKIE = 'showtrackr_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ── Password hashing ────────────────────────────────────────────────────────
export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const derived = scryptSync(password, salt, 64);
	return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
	if (!stored) return false;
	const [scheme, saltHex, hashHex] = stored.split('$');
	if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const expected = Buffer.from(hashHex, 'hex');
	const derived = scryptSync(password, salt, expected.length);
	return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// ── Stateless signed session cookie ─────────────────────────────────────────
// NOTE: because sessions are stateless, there is no server-side revocation —
// changing SESSION_SECRET invalidates ALL cookies (the only "logout everywhere"
// lever). Acceptable for single-user; revisit with a sessions table if needed.
function secret(): string {
	const s = env.SESSION_SECRET;
	// Fail fast on a weak/missing secret. Checked at request time (not module
	// load) so the build/analyse step with empty env doesn't throw.
	if (!s || s.length < 32) {
		throw new Error('SESSION_SECRET must be set and at least 32 characters long.');
	}
	return s;
}

function base64url(input: Buffer | string): string {
	return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
	return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issueToken(userId: number): string {
	const exp = Math.floor(nowSeconds() + SESSION_TTL_SECONDS);
	const payload = base64url(JSON.stringify({ uid: userId, exp }));
	return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): { uid: number } | null {
	if (!token) return null;
	const [payload, signature] = token.split('.');
	if (!payload || !signature) return null;

	// Constant-time signature comparison.
	const expected = sign(payload);
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
			uid: number;
			exp: number;
		};
		if (typeof data.uid !== 'number' || typeof data.exp !== 'number') return null;
		if (data.exp < nowSeconds()) return null;
		return { uid: data.uid };
	} catch {
		return null;
	}
}

function nowSeconds(): number {
	return Date.now() / 1000;
}

// ── Cookie helpers (bound to SvelteKit `cookies`) ───────────────────────────
export function setSessionCookie(cookies: Cookies, userId: number): void {
	cookies.set(SESSION_COOKIE, issueToken(userId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: useSecureCookie(),
		maxAge: SESSION_TTL_SECONDS
	});
}

/**
 * We're HTTP-first by default (self-host, PLAN §5). A `Secure` cookie would
 * never be sent over plain HTTP, breaking login. So derive `secure` from the
 * public base URL scheme (https → secure), overridable by INSECURE_COOKIES.
 */
function useSecureCookie(): boolean {
	if (env.INSECURE_COOKIES) return false;
	return (publicEnv.PUBLIC_BASE_URL ?? '').startsWith('https://');
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

// ── User lookups ────────────────────────────────────────────────────────────
/** Resolve the current user from the request cookie (used in hooks). */
export async function resolveUser(cookies: Cookies): Promise<SessionUser | null> {
	const claims = verifyToken(cookies.get(SESSION_COOKIE));
	if (!claims) return null;
	const rows = await db
		.select({
			id: schema.users.id,
			email: schema.users.email,
			displayName: schema.users.displayName
		})
		.from(schema.users)
		.where(eq(schema.users.id, claims.uid))
		.limit(1);
	return rows[0] ?? null;
}

export async function findUserByEmail(email: string) {
	const rows = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, email.toLowerCase()))
		.limit(1);
	return rows[0] ?? null;
}

/** Count users — drives the first-run "create account" flow on /login. */
export async function userCount(): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
	return row?.n ?? 0;
}

/** Create the single user on first run. Returns the new user id. */
export async function createUser(input: {
	email: string;
	password: string;
	displayName?: string;
}): Promise<number> {
	const [row] = await db
		.insert(schema.users)
		.values({
			email: input.email.toLowerCase(),
			passwordHash: hashPassword(input.password),
			displayName: input.displayName ?? input.email.split('@')[0],
			timezone: 'Europe/Paris',
			language: 'en'
		})
		.returning({ id: schema.users.id });
	return row.id;
}
