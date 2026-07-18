<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const hours = $derived(data.stats ? Math.round(data.stats.minutesWatched / 60) : 0);
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

	<nav class="settings-links">
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
