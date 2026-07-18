/**
 * Persistence + concurrency control for the per-user "Import from TV Time" jobs.
 *
 * The `import_jobs` table is the source of truth the UI polls; a small in-process
 * Set is a fast-path guard so a second upload is rejected before it even touches
 * the DB. All queries are scoped to a single `userId` — a user can only ever see
 * or affect their own jobs.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { ImportJob } from '@showtrackr/db';
import type { ImportProgress } from '@showtrackr/importer';

/** userIds with an import running in THIS process (fast concurrency guard). */
const runningInProcess = new Set<number>();

let staleReconciled = false;

/**
 * On the first import interaction after a (re)start, mark any job left in
 * `pending`/`running` by a previous process as errored — there is no worker to
 * resume it, so it is stale. Runs at most once per process.
 */
export async function reconcileStaleJobsOnce(): Promise<void> {
	if (staleReconciled) return;
	staleReconciled = true;
	const now = new Date();
	await db
		.update(schema.importJobs)
		.set({
			status: 'error',
			error: 'Import was interrupted by a server restart. Please try again.',
			finishedAt: now,
			updatedAt: now
		})
		.where(inArray(schema.importJobs.status, ['pending', 'running']));
}

/** The user's most recent job (any status), or null if they never imported. */
export async function getLatestJob(userId: number): Promise<ImportJob | null> {
	const [job] = await db
		.select()
		.from(schema.importJobs)
		.where(eq(schema.importJobs.userId, userId))
		.orderBy(desc(schema.importJobs.id))
		.limit(1);
	return job ?? null;
}

/** True when the user already has a pending/running import (in-process or in DB). */
export async function hasActiveJob(userId: number): Promise<boolean> {
	if (runningInProcess.has(userId)) return true;
	const [job] = await db
		.select({ id: schema.importJobs.id })
		.from(schema.importJobs)
		.where(
			and(
				eq(schema.importJobs.userId, userId),
				inArray(schema.importJobs.status, ['pending', 'running'])
			)
		)
		.limit(1);
	return !!job;
}

/** Create a fresh `pending` job row and return its id. */
export async function createJob(userId: number): Promise<number> {
	const [row] = await db
		.insert(schema.importJobs)
		.values({
			userId,
			status: 'pending',
			stepLabel: 'Queued',
			message: 'Preparing your export…'
		})
		.returning({ id: schema.importJobs.id });
	return row!.id;
}

export function markRunningInProcess(userId: number): void {
	runningInProcess.add(userId);
}

export function clearRunningInProcess(userId: number): void {
	runningInProcess.delete(userId);
}

export async function setJobRunning(id: number, message = 'Unpacking export…'): Promise<void> {
	await db
		.update(schema.importJobs)
		.set({ status: 'running', message, updatedAt: new Date() })
		.where(eq(schema.importJobs.id, id));
}

/** Persist a progress tick from the pipeline (caller throttles the call rate). */
export async function updateJobProgress(id: number, p: ImportProgress): Promise<void> {
	await db
		.update(schema.importJobs)
		.set({
			status: 'running',
			step: p.step,
			stepLabel: p.stepLabel,
			processed: p.processed,
			total: p.total,
			message: p.message ?? null,
			updatedAt: new Date()
		})
		.where(eq(schema.importJobs.id, id));
}

export async function finishJob(
	id: number,
	outcome: { ok: true; message: string } | { ok: false; error: string }
): Promise<void> {
	const now = new Date();
	if (outcome.ok) {
		await db
			.update(schema.importJobs)
			.set({ status: 'done', message: outcome.message, error: null, finishedAt: now, updatedAt: now })
			.where(eq(schema.importJobs.id, id));
	} else {
		await db
			.update(schema.importJobs)
			.set({ status: 'error', error: outcome.error, finishedAt: now, updatedAt: now })
			.where(eq(schema.importJobs.id, id));
	}
}
