/**
 * Community feature — cross-user reads with a hard visibility boundary.
 *
 * The instance is multi-user; every user has an `is_public` flag (default true).
 * A user's stats & library are readable by ANOTHER user ONLY when that target is
 * public (or the viewer is looking at themselves). This module is the single
 * gate for that rule so no route can accidentally leak a private profile.
 *
 * PRIVACY INVARIANTS (enforced here, relied on by every /community route):
 *  - `email` and `password_hash` are NEVER selected into any community view.
 *    Only `displayName` (masked to a handle when null), stats, and library data
 *    leave this module.
 *  - `getVisibleProfile()` returns `null` for a private target that isn't the
 *    viewer; callers translate that to a 404 (indistinguishable from "no such
 *    user", so private accounts aren't even enumerable).
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from './db';

/** Public-safe identity for a community user — no email, no hash, ever. */
export type CommunityProfile = {
	id: number;
	displayName: string;
	isPublic: boolean;
	isSelf: boolean;
};

/**
 * Human-facing name that never exposes PII. Falls back to a masked handle
 * (`User #<id>`) when the user has no display name — we must not fall back to
 * the email as the profile/library views do for the owner's own page.
 */
export function maskedHandle(displayName: string | null, id: number): string {
	const trimmed = displayName?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : `User #${id}`;
}

/**
 * Visibility guard. Returns the target's public-safe profile when the viewer is
 * allowed to see it (target is public OR viewer === target), otherwise `null`.
 * Routes MUST treat `null` as a 404.
 */
export async function getVisibleProfile(
	targetId: number,
	viewerId: number
): Promise<CommunityProfile | null> {
	if (!Number.isFinite(targetId)) return null;
	const [row] = await db
		.select({
			id: schema.users.id,
			displayName: schema.users.displayName,
			isPublic: schema.users.isPublic
		})
		.from(schema.users)
		.where(eq(schema.users.id, targetId))
		.limit(1);

	if (!row) return null;
	const isSelf = row.id === viewerId;
	if (!row.isPublic && !isSelf) return null; // private → invisible to others

	return {
		id: row.id,
		displayName: maskedHandle(row.displayName, row.id),
		isPublic: row.isPublic,
		isSelf
	};
}

/** One row of the community directory / leaderboard. */
export type CommunityMember = {
	id: number;
	displayName: string;
	isSelf: boolean;
	minutesWatched: number;
	episodesWatched: number;
	moviesWatched: number;
	showsFollowed: number;
};

/**
 * Everyone visible to the viewer: all `is_public` users PLUS the viewer
 * themselves (so a private user still sees their own row). Left-joined to
 * `user_stats` for the headline numbers. Never selects email/hash.
 */
export async function listVisibleMembers(viewerId: number): Promise<CommunityMember[]> {
	const rows = await db
		.select({
			id: schema.users.id,
			displayName: schema.users.displayName,
			minutesWatched: sql<number>`coalesce(${schema.userStats.minutesWatched}, 0)::int`,
			episodesWatched: sql<number>`coalesce(${schema.userStats.episodesWatched}, 0)::int`,
			moviesWatched: sql<number>`coalesce(${schema.userStats.moviesWatched}, 0)::int`,
			showsFollowed: sql<number>`coalesce(${schema.userStats.showsFollowed}, 0)::int`
		})
		.from(schema.users)
		.leftJoin(schema.userStats, eq(schema.userStats.userId, schema.users.id))
		.where(or(eq(schema.users.isPublic, true), eq(schema.users.id, viewerId)));

	return rows.map((r) => ({
		id: r.id,
		displayName: maskedHandle(r.displayName, r.id),
		isSelf: r.id === viewerId,
		minutesWatched: r.minutesWatched,
		episodesWatched: r.episodesWatched,
		moviesWatched: r.moviesWatched,
		showsFollowed: r.showsFollowed
	}));
}

/** A followed show in a user's public library (read-only projection). */
export type FollowedShow = {
	showId: number;
	name: string;
	posterPath: string | null;
	status: string;
};

/**
 * The shows a user follows (follows ⨝ catalog_shows). Scoped to `userId`.
 * Callers are responsible for gating the target through `getVisibleProfile`
 * first — this function does not re-check visibility.
 */
export async function getFollowedShows(userId: number): Promise<FollowedShow[]> {
	const rows = await db
		.select({
			showId: schema.catalogShows.id,
			name: schema.catalogShows.name,
			posterPath: schema.catalogShows.posterPath,
			status: schema.follows.status
		})
		.from(schema.follows)
		.innerJoin(schema.catalogShows, eq(schema.follows.showId, schema.catalogShows.id))
		.where(eq(schema.follows.userId, userId))
		.orderBy(schema.catalogShows.name);
	return rows.map((r) => ({
		showId: r.showId,
		name: r.name,
		posterPath: r.posterPath,
		status: r.status as string
	}));
}

/** Read the persisted aggregate row for a user (or null when never computed). */
export async function getUserStats(userId: number) {
	const [row] = await db
		.select()
		.from(schema.userStats)
		.where(eq(schema.userStats.userId, userId))
		.limit(1);
	return row ?? null;
}

/** Leaderboard row (visible users only). */
export type LeaderboardEntry = {
	id: number;
	displayName: string;
	isSelf: boolean;
	minutesWatched: number;
	episodesWatched: number;
	/** Minutes watched in the current calendar month (from episode_watches). */
	monthMinutes: number;
	/** Distinct episodes watched in the current calendar month. */
	monthEpisodes: number;
};

/**
 * Leaderboard across visible users. All-time totals come from `user_stats`;
 * the "this month" numbers are computed from `episode_watches` for the current
 * calendar month (the complete source — `stats_monthly` is only a partial seed,
 * per stats.ts). Never selects email/hash.
 */
export async function getLeaderboard(viewerId: number): Promise<LeaderboardEntry[]> {
	const members = await listVisibleMembers(viewerId);
	if (members.length === 0) return [];
	const ids = members.map((m) => m.id);

	// This-month minutes/episodes per user, restricted to the visible set.
	const monthRows = await db
		.select({
			userId: schema.episodeWatches.userId,
			minutes: sql<number>`coalesce(sum(${schema.episodeWatches.watchCount} * coalesce(${schema.catalogEpisodes.runtimeMin}, 0)), 0)::int`,
			episodes: sql<number>`count(*)::int`
		})
		.from(schema.episodeWatches)
		.innerJoin(
			schema.catalogEpisodes,
			eq(schema.episodeWatches.episodeId, schema.catalogEpisodes.id)
		)
		.where(
			and(
				inArray(schema.episodeWatches.userId, ids),
				sql`${schema.episodeWatches.lastWatchedAt} is not null`,
				sql`date_trunc('month', ${schema.episodeWatches.lastWatchedAt}) = date_trunc('month', now())`
			)
		)
		.groupBy(schema.episodeWatches.userId);

	const monthByUser = new Map(monthRows.map((r) => [r.userId, r]));

	return members.map((m) => {
		const month = monthByUser.get(m.id);
		return {
			id: m.id,
			displayName: m.displayName,
			isSelf: m.isSelf,
			minutesWatched: m.minutesWatched,
			episodesWatched: m.episodesWatched,
			monthMinutes: month?.minutes ?? 0,
			monthEpisodes: month?.episodes ?? 0
		};
	});
}

/**
 * Watched-movie ids for a user (for the compare intersection). Scoped to
 * `userId`; caller gates visibility first.
 */
export async function getWatchedMovieIds(userId: number): Promise<number[]> {
	const rows = await db
		.select({ movieId: schema.movieWatches.movieId })
		.from(schema.movieWatches)
		.where(eq(schema.movieWatches.userId, userId));
	return rows.map((r) => r.movieId);
}
