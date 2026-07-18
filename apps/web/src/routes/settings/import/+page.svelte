<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TOTAL_STEPS = 7;
	const ENDPOINT = '/settings/import/job';

	type Job = PageData['job'];

	let job = $state<Job>(data.job);
	let file = $state<File | null>(null);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let dragOver = $state(false);

	const active = $derived(!!job && (job.status === 'pending' || job.status === 'running'));
	const pct = $derived(job && job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0);
	const canSubmit = $derived(!!file && !uploading && !active && data.tmdbConfigured);

	async function refresh() {
		try {
			const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
			if (!res.ok) return;
			const body = await res.json();
			job = body.job;
		} catch {
			// transient network error — the next tick will retry
		}
	}

	// Poll while a job is in flight; stop as soon as it finishes.
	$effect(() => {
		if (!active) return;
		const iv = setInterval(refresh, 1500);
		return () => clearInterval(iv);
	});

	function pickFile(f: File | null | undefined) {
		uploadError = null;
		if (!f) {
			file = null;
			return;
		}
		if (!/\.zip$/i.test(f.name) && f.type !== 'application/zip') {
			uploadError = 'Please choose your TV Time export .zip file.';
			file = null;
			return;
		}
		file = f;
	}

	function onFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		pickFile(input.files?.[0]);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		pickFile(e.dataTransfer?.files?.[0]);
	}

	async function submit() {
		if (!file) return;
		uploading = true;
		uploadError = null;
		try {
			const res = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/zip', accept: 'application/json' },
				body: file
			});
			if (!res.ok) {
				let message = `Upload failed (${res.status}).`;
				try {
					const body = await res.json();
					if (body?.message) message = body.message;
				} catch {
					/* keep default */
				}
				uploadError = message;
				return;
			}
			// Optimistically flip into the polling state; refresh() takes over.
			file = null;
			job = {
				...(job ?? {}),
				status: 'pending',
				step: 0,
				stepLabel: 'Queued',
				processed: 0,
				total: 0,
				message: 'Preparing your export…',
				error: null
			} as Job;
			await refresh();
		} catch {
			uploadError = 'Upload failed — check your connection and try again.';
		} finally {
			uploading = false;
		}
	}
</script>

<div class="page">
	<div class="page-header">
		<a class="back" href="/profile" aria-label="Back to profile">‹</a>
		<h1>Import from TV Time</h1>
	</div>

	<p class="muted intro">
		Upload your TV Time <strong>GDPR data export</strong> (a <code>.zip</code>) and we'll rebuild
		your followed shows, full episode history, ratings, lists and stats into your account. The
		import is safe to re-run.
	</p>

	{#if !data.tmdbConfigured}
		<div class="card notice notice-warn">
			<strong>TMDB key missing.</strong> The server has no <code>TMDB_API_KEY</code> configured, so
			shows can't be resolved. Ask the administrator to set it before importing.
		</div>
	{/if}

	{#if active}
		<div class="card progress-card">
			<div class="progress-head">
				<span class="step-badge">Step {Math.max(1, job?.step ?? 1)}/{TOTAL_STEPS}</span>
				<span class="step-label">{job?.stepLabel ?? 'Working…'}</span>
			</div>
			<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
				<div class="bar-fill" style="width:{job && job.total > 0 ? pct : 100}%" class:indeterminate={!job || job.total === 0}></div>
			</div>
			<div class="progress-meta">
				{#if job && job.total > 0}
					<span class="counts">{job.processed.toLocaleString()} / {job.total.toLocaleString()}</span>
				{/if}
				{#if job?.message}<span class="msg muted">{job.message}</span>{/if}
			</div>
		</div>
	{:else if job?.status === 'done'}
		<div class="card notice notice-ok">
			<strong>Import complete 🎉</strong>
			<p class="msg">{job.message}</p>
			<a class="btn btn-accent btn-block" href="/library">Go to your library</a>
		</div>
		<button class="btn btn-block again" onclick={() => { job = null; }}>Import another export</button>
	{:else if job?.status === 'error'}
		<div class="card notice notice-error">
			<strong>Import failed</strong>
			<p class="msg">{job.error}</p>
		</div>
	{/if}

	{#if !active && job?.status !== 'done'}
		<div
			class="dropzone"
			class:drag={dragOver}
			role="button"
			tabindex="0"
			ondragover={(e) => { e.preventDefault(); dragOver = true; }}
			ondragleave={() => (dragOver = false)}
			ondrop={onDrop}
		>
			<label class="drop-inner">
				<span class="drop-icon" aria-hidden="true">⬆</span>
				<span class="drop-title">{file ? file.name : 'Choose or drop your export.zip'}</span>
				<span class="drop-hint muted">TV Time GDPR export · .zip</span>
				<input type="file" accept=".zip,application/zip" onchange={onFileInput} hidden />
			</label>
		</div>

		{#if uploadError}<p class="error-text">{uploadError}</p>{/if}

		<button class="btn btn-accent btn-block submit" disabled={!canSubmit} onclick={submit}>
			{uploading ? 'Uploading…' : 'Start import'}
		</button>
	{/if}
</div>

<style>
	.back {
		font-size: 1.8rem;
		line-height: 1;
		color: var(--text-muted);
		padding: 0 4px;
	}

	.intro {
		font-size: 0.92rem;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	code {
		background: var(--bg-elev-2);
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 0.85em;
	}

	.notice {
		padding: 16px;
		margin-bottom: 16px;
	}

	.notice p {
		margin: 8px 0 0;
	}

	.notice-warn {
		border-color: var(--star);
	}

	.notice-ok {
		border-color: var(--success);
	}

	.notice-error {
		border-color: var(--danger);
	}

	.notice-error .msg {
		color: var(--danger);
	}

	.notice-ok .btn {
		margin-top: 14px;
	}

	.progress-card {
		padding: 18px;
		margin-bottom: 16px;
	}

	.progress-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}

	.step-badge {
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: 0.75rem;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: 999px;
		white-space: nowrap;
	}

	.step-label {
		font-weight: 600;
		font-size: 0.95rem;
	}

	.bar {
		height: 10px;
		background: var(--bg-elev-2);
		border-radius: 999px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		transition: width 0.4s ease;
	}

	.bar-fill.indeterminate {
		width: 40% !important;
		animation: slide 1.2s ease-in-out infinite;
	}

	@keyframes slide {
		0% { margin-left: -40%; }
		100% { margin-left: 100%; }
	}

	.progress-meta {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
		font-size: 0.85rem;
	}

	.counts {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.msg {
		font-size: 0.9rem;
	}

	.dropzone {
		border: 2px dashed var(--border);
		border-radius: var(--radius);
		background: var(--bg-elev);
		margin-bottom: 16px;
		transition: border-color 0.15s ease, background 0.15s ease;
	}

	.dropzone.drag {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
	}

	.drop-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 32px 16px;
		cursor: pointer;
		text-align: center;
	}

	.drop-icon {
		font-size: 1.8rem;
		color: var(--accent);
	}

	.drop-title {
		font-weight: 600;
		word-break: break-all;
	}

	.drop-hint {
		font-size: 0.8rem;
	}

	.submit {
		margin-top: 4px;
	}

	.again {
		margin-top: 12px;
	}
</style>
