/**
 * Import job endpoint.
 *
 *   GET  /settings/import/job   → the current user's latest job (polled by the UI)
 *   POST /settings/import/job   → upload the GDPR export .zip and start an import
 *
 * The upload is sent as the RAW request body (Content-Type: application/zip), not
 * multipart, so we can stream it straight to a temp file without buffering the
 * whole archive in memory (adapter-node's BODY_SIZE_LIMIT still gates the size).
 */
import { error, json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as jobs from '$lib/server/import/jobs';
import { isZipFile } from '$lib/server/import/unzip';
import { startImportJob } from '$lib/server/import/runner';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Sign in to view your import.');
	await jobs.reconcileStaleJobsOnce();
	const job = await jobs.getLatestJob(locals.user.id);
	return json({ job });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Sign in to import.');
	const userId = locals.user.id;

	await jobs.reconcileStaleJobsOnce();
	if (await jobs.hasActiveJob(userId)) {
		throw error(409, 'An import is already running for your account. Please wait for it to finish.');
	}
	if (!request.body) {
		throw error(400, 'No file was uploaded.');
	}

	// Stream the upload to a temp file inside a per-run working directory.
	const workDir = await mkdtemp(join(tmpdir(), 'showtrackr-import-'));
	const zipPath = join(workDir, 'export.zip');
	const extractDir = join(workDir, 'extracted');

	try {
		await pipeline(
			Readable.fromWeb(request.body as unknown as import('node:stream/web').ReadableStream),
			createWriteStream(zipPath)
		);
	} catch {
		await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
		throw error(400, 'Upload failed while receiving the file.');
	}

	if (!(await isZipFile(zipPath))) {
		await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
		throw error(400, 'The uploaded file is not a valid .zip archive.');
	}

	// Create the job row, then hand off to the background runner (owns cleanup).
	const jobId = await jobs.createJob(userId);
	startImportJob({ userId, jobId, zipPath, extractDir, workDir });

	return json({ id: jobId, status: 'pending' }, { status: 202 });
};
