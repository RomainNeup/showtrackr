/**
 * Background runner for a per-user GDPR import.
 *
 * `startImportJob` returns immediately after kicking off a fire-and-forget async
 * task (single-instance node process — good enough for a self-hosted app). The
 * task unpacks the already-uploaded zip, runs the reconstruction pipeline scoped
 * to the user's own id, streams progress into `import_jobs`, and ALWAYS cleans up
 * the temp working directory in a finally block.
 */
import { rm } from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { runImport, type ImportProgress, type ValidationReport } from '@showtrackr/importer';
import { extractZip, locateDataDir } from './unzip';
import * as jobs from './jobs';

export interface StartImportArgs {
	userId: number;
	jobId: number;
	/** Path to the uploaded zip on disk. */
	zipPath: string;
	/** Directory to extract into (inside workDir). */
	extractDir: string;
	/** Top-level temp dir to remove when done (contains zipPath + extractDir). */
	workDir: string;
}

/** Minimum ms between DB progress writes (except on step change / completion). */
const PROGRESS_WRITE_INTERVAL_MS = 750;

function summarize(report: ValidationReport): string {
	const hours = Math.round(report.computedTotalMinutes / 60);
	return (
		`Imported ${report.computedEpisodes.toLocaleString()} episodes and ` +
		`${report.computedMovies.toLocaleString()} movies across ` +
		`${report.showsFollowed.toLocaleString()} followed shows (${hours.toLocaleString()} h watched).`
	);
}

export function startImportJob(args: StartImportArgs): void {
	const { userId, jobId, zipPath, extractDir, workDir } = args;
	jobs.markRunningInProcess(userId);

	// Fire-and-forget: the HTTP handler has already responded; this runs on its own.
	void (async () => {
		let lastWrite = 0;
		let lastStep = -1;
		try {
			await jobs.setJobRunning(jobId);

			await extractZip(zipPath, extractDir);
			const dataDir = await locateDataDir(extractDir);

			const tmdbApiKey = env.TMDB_API_KEY;
			if (!tmdbApiKey) {
				throw new Error('TMDB_API_KEY is not configured on the server — cannot resolve shows.');
			}

			const report = await runImport({
				dataDir,
				userId,
				tmdbApiKey,
				db,
				onProgress: async (p: ImportProgress) => {
					const now = Date.now();
					const stepChanged = p.step !== lastStep;
					const complete = p.total > 0 && p.processed >= p.total;
					if (stepChanged || complete || now - lastWrite >= PROGRESS_WRITE_INTERVAL_MS) {
						lastWrite = now;
						lastStep = p.step;
						await jobs.updateJobProgress(jobId, p);
					}
				}
			});

			await jobs.finishJob(jobId, { ok: true, message: summarize(report) });
		} catch (err) {
			await jobs
				.finishJob(jobId, {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				})
				.catch(() => undefined);
		} finally {
			jobs.clearRunningInProcess(userId);
			await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
		}
	})();
}
