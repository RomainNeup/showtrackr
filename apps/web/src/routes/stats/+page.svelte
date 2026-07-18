<script lang="ts">
	import { enhance } from '$app/forms';
	import StatTile from '$lib/components/StatTile.svelte';
	import { tmdbImage } from '$lib/tmdb-image';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const hours = $derived(Math.round(data.stats.minutesWatched / 60));
	const days = $derived((data.stats.minutesWatched / 60 / 24).toFixed(1));

	// Scale the monthly bars against the busiest month.
	const maxMonth = $derived(Math.max(1, ...data.stats.perMonth.map((m) => m.minutes)));

	function monthLabel(period: string): string {
		// period is 'YYYY-MM-DD' (truncated to month start)
		const [y, m] = period.split('-');
		return `${m}/${y.slice(2)}`;
	}
</script>

<div class="page">
	<div class="page-header">
		<h1>Stats</h1>
	</div>

	<div class="tiles">
		<StatTile label="Hours watched" value={hours.toLocaleString()} sub={`${days} days`} icon="⏱" />
		<StatTile label="Episodes" value={data.stats.episodesWatched.toLocaleString()} icon="📺" />
		<StatTile label="Movies" value={data.stats.moviesWatched.toLocaleString()} icon="🎬" />
		<StatTile label="Shows followed" value={data.stats.showsFollowed.toLocaleString()} icon="➕" />
	</div>

	<!-- Per-month viewing time -->
	<section class="block">
		<h2 class="section-title">Viewing time by month</h2>
		{#if data.stats.perMonth.length === 0}
			<p class="muted">No watch history yet.</p>
		{:else}
			<div class="bars">
				{#each data.stats.perMonth as m (m.period)}
					<div class="bar-col" title={`${Math.round(m.minutes / 60)}h · ${m.episodes} ep`}>
						<div class="bar" style={`height: ${Math.max(4, (m.minutes / maxMonth) * 100)}%`}></div>
						<span class="bar-label">{monthLabel(m.period)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Top shows -->
	<section class="block">
		<h2 class="section-title">Top shows</h2>
		{#if data.stats.topShows.length === 0}
			<p class="muted">Mark some episodes watched to see your top shows.</p>
		{:else}
			<ol class="top-list">
				{#each data.stats.topShows as s, i (s.showId)}
					{@const poster = tmdbImage(s.posterPath, 'w92')}
					<li>
						<a href={`/show/${s.showId}`} class="top-row">
							<span class="rank">{i + 1}</span>
							{#if poster}<img src={poster} alt="" />{/if}
							<span class="top-name">{s.name}</span>
							<span class="muted top-time">{Math.round(s.minutes / 60)}h</span>
						</a>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<form method="POST" action="?/recompute" use:enhance={() => async ({ update }) => update()}>
		<button class="btn recompute" type="submit">↻ Recompute stats</button>
	</form>
</div>

<style>
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

	.bars {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		height: 140px;
		overflow-x: auto;
		padding-bottom: 4px;
	}

	.bar-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		flex: 1;
		min-width: 28px;
		height: 100%;
	}

	.bar {
		width: 60%;
		min-height: 4px;
		background: var(--accent);
		border-radius: 4px 4px 0 0;
	}

	.bar-label {
		font-size: 0.65rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.top-list {
		list-style: none;
		margin: 0;
		padding: 0;
		counter-reset: rank;
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

	.top-row img {
		width: 34px;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 4px;
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

	.recompute {
		width: 100%;
	}
</style>
