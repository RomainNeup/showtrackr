<script lang="ts">
	import BackButton from '$lib/components/BackButton.svelte';
	import ShowCard from '$lib/components/ShowCard.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const hours = $derived(Math.round(data.stats.minutesWatched / 60));
	const days = $derived((data.stats.minutesWatched / 60 / 24).toFixed(1));

	function initials(name: string): string {
		return name.replace(/^User #/, '#').slice(0, 2).toUpperCase();
	}
</script>

<div class="page">
	<div class="page-header">
		<BackButton />
		<h1>Profile</h1>
	</div>

	<div class="card profile-card">
		<div class="avatar" aria-hidden="true">{initials(data.profile.displayName)}</div>
		<div class="who">
			<div class="name">
				{data.profile.displayName}
				{#if data.profile.isSelf}<span class="you-badge">You</span>{/if}
			</div>
			<div class="muted vis">
				{data.profile.isPublic ? 'Public profile' : 'Private (only visible to you)'}
			</div>
		</div>
	</div>

	{#if !data.profile.isSelf}
		<a class="compare-cta" href={`/community/${data.profile.id}/compare`}>
			<span aria-hidden="true">🔀</span> Compare with me
		</a>
	{/if}

	<div class="tiles">
		<StatTile label="Hours watched" value={hours.toLocaleString()} sub={`${days} days`} icon="⏱" />
		<StatTile label="Episodes" value={data.stats.episodesWatched.toLocaleString()} icon="📺" />
		<StatTile label="Movies" value={data.stats.moviesWatched.toLocaleString()} icon="🎬" />
		<StatTile label="Shows followed" value={data.stats.showsFollowed.toLocaleString()} icon="➕" />
	</div>

	{#if data.stats.topShows.length > 0}
		<section class="block">
			<h2 class="section-title">Top shows</h2>
			<ol class="top-list">
				{#each data.stats.topShows as s, i (s.showId)}
					<li class="top-row">
						<span class="rank">{i + 1}</span>
						<span class="top-name">{s.name}</span>
						<span class="muted top-time">{Math.round(s.minutes / 60)}h</span>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<section class="block">
		<h2 class="section-title">Followed shows ({data.shows.length})</h2>
		{#if data.shows.length === 0}
			<p class="muted">No followed shows.</p>
		{:else}
			<div class="grid">
				{#each data.shows as s (s.showId)}
					<ShowCard href={`/show/${s.showId}`} title={s.name} posterPath={s.posterPath} />
				{/each}
			</div>
		{/if}
	</section>

	<section class="block">
		<h2 class="section-title">Movies watched ({data.movies.length})</h2>
		{#if data.movies.length === 0}
			<p class="muted">No watched movies.</p>
		{:else}
			<div class="grid">
				{#each data.movies as m (m.movieId)}
					<ShowCard
						href={`/movie/${m.movieId}`}
						title={m.title}
						posterPath={m.posterPath}
						badge={m.watchCount > 1 ? `×${m.watchCount}` : null}
					/>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.page-header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.profile-card {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 20px;
		margin-bottom: 16px;
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
		font-size: 1.4rem;
		font-weight: 800;
		flex-shrink: 0;
	}

	.who {
		min-width: 0;
	}

	.name {
		font-weight: 700;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.you-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		background: var(--accent);
		color: var(--accent-contrast);
		padding: 1px 6px;
		border-radius: 999px;
	}

	.vis {
		font-size: 0.82rem;
	}

	.compare-cta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: var(--accent);
		color: var(--accent-contrast);
		font-weight: 700;
		padding: 10px 16px;
		border-radius: 999px;
		margin-bottom: 20px;
		min-height: 44px;
	}

	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-bottom: 24px;
	}

	.block {
		margin-bottom: 28px;
	}

	.section-title {
		font-size: 1rem;
		margin: 0 0 12px;
	}

	.top-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.top-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}

	.rank {
		width: 22px;
		font-weight: 800;
		color: var(--text-muted);
		text-align: center;
	}

	.top-name {
		flex: 1;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.top-time {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}
</style>
