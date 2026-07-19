<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const hours = $derived(data.stats ? Math.round(data.stats.minutesWatched / 60) : 0);

	// Optimistic local state for the visibility switch so it flips instantly;
	// the form action persists it (and the load re-runs on invalidation).
	let isPublic = $state(data.profile?.isPublic ?? true);
	let visForm = $state<HTMLFormElement | null>(null);
</script>

<div class="page">
	<div class="page-header">
		<h1>Profile</h1>
	</div>

	<div class="card profile-card">
		<div class="avatar" aria-hidden="true">
			{(data.profile?.displayName ?? data.profile?.email ?? '?').slice(0, 1).toUpperCase()}
		</div>
		<div>
			<div class="name">{data.profile?.displayName ?? 'You'}</div>
			<div class="muted email">{data.profile?.email}</div>
		</div>
	</div>

	<dl class="details">
		<div><dt>Timezone</dt><dd>{data.profile?.timezone}</dd></div>
		<div><dt>Language</dt><dd>{data.profile?.language}</dd></div>
		{#if data.stats}
			<div><dt>Hours watched</dt><dd>{hours.toLocaleString()} h</dd></div>
			<div><dt>Episodes</dt><dd>{data.stats.episodesWatched.toLocaleString()}</dd></div>
			<div><dt>Movies</dt><dd>{data.stats.moviesWatched.toLocaleString()}</dd></div>
			<div><dt>Shows followed</dt><dd>{data.stats.showsFollowed.toLocaleString()}</dd></div>
		{/if}
	</dl>

	<!-- Community visibility toggle -->
	<form
		method="POST"
		action="?/setVisibility"
		bind:this={visForm}
		use:enhance={() => async ({ update }) => update({ reset: false })}
		class="vis-card"
	>
		<div class="vis-text">
			<span class="vis-title">Public profile</span>
			<span class="muted vis-sub">
				When on, others on this instance can see your stats & library in Community.
				Your email is never shared.
			</span>
		</div>
		<label class="switch" class:on={isPublic}>
			<input
				type="checkbox"
				name="isPublic"
				checked={isPublic}
				onchange={(e) => {
					isPublic = e.currentTarget.checked;
					visForm?.requestSubmit();
				}}
				aria-label="Public profile"
			/>
			<span class="track" aria-hidden="true"><span class="thumb"></span></span>
		</label>
	</form>

	<nav class="settings-links">
		<a class="settings-link" href="/community">
			<span class="settings-icon" aria-hidden="true">👥</span>
			<span class="settings-text">
				<span class="settings-title">Community</span>
				<span class="muted settings-sub">Discover other viewers, compare & rank</span>
			</span>
			<span class="chevron" aria-hidden="true">›</span>
		</a>
		<a class="settings-link" href="/settings/import">
			<span class="settings-icon" aria-hidden="true">⬆</span>
			<span class="settings-text">
				<span class="settings-title">Import from TV Time</span>
				<span class="muted settings-sub">Upload your GDPR export .zip</span>
			</span>
			<span class="chevron" aria-hidden="true">›</span>
		</a>
	</nav>

	<form method="POST" action="/logout">
		<button class="btn btn-block logout" type="submit">Sign out</button>
	</form>
</div>

<style>
	.profile-card {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 20px;
		margin-bottom: 20px;
	}

	.avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-contrast);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.6rem;
		font-weight: 800;
		flex-shrink: 0;
	}

	.name {
		font-weight: 700;
		font-size: 1.1rem;
	}

	.email {
		font-size: 0.85rem;
	}

	.details {
		margin: 0 0 24px;
	}

	.details > div {
		display: flex;
		justify-content: space-between;
		padding: 12px 0;
		border-bottom: 1px solid var(--border);
	}

	dt {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	dd {
		margin: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.vis-card {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 16px;
	}

	.vis-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.vis-title {
		font-weight: 600;
	}

	.vis-sub {
		font-size: 0.8rem;
		line-height: 1.3;
	}

	/* Toggle switch — a styled checkbox. */
	.switch {
		position: relative;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}

	.switch input {
		position: absolute;
		opacity: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		cursor: pointer;
	}

	.switch .track {
		width: 46px;
		height: 28px;
		border-radius: 999px;
		background: var(--bg-elev-2, #3a3a3a);
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		padding: 2px;
		transition: background 0.15s ease;
	}

	.switch.on .track {
		background: var(--accent);
		border-color: var(--accent);
	}

	.switch .thumb {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s ease;
	}

	.switch.on .thumb {
		transform: translateX(18px);
	}

	.switch input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.settings-links {
		margin-bottom: 24px;
	}

	.settings-link {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-height: 44px;
	}

	.settings-icon {
		font-size: 1.2rem;
		color: var(--accent);
		width: 24px;
		text-align: center;
	}

	.settings-text {
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	.settings-title {
		font-weight: 600;
	}

	.settings-sub {
		font-size: 0.8rem;
	}

	.chevron {
		color: var(--text-muted);
		font-size: 1.4rem;
	}

	.logout {
		color: var(--danger);
		border-color: var(--danger);
	}
</style>
