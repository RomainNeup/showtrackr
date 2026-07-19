<script lang="ts">
	import ShowCard from '$lib/components/ShowCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Mode = 'series' | 'movies';
	let mode = $state<Mode>('series');

	let activeStatus = $state<'all' | string>('all');

	const filtered = $derived(
		activeStatus === 'all' ? data.shows : data.shows.filter((s) => s.status === activeStatus)
	);

	const favorites = $derived(data.shows.filter((s) => s.isFavorite));

	const labels: Record<string, string> = {
		all: 'All',
		watching: 'Watching',
		upcoming: 'Upcoming',
		stopped: 'Stopped',
		archived: 'Archived'
	};

	const count = $derived(
		mode === 'series' ? `${data.shows.length} shows` : `${data.movies.length} movies`
	);
</script>

<div class="page">
	<div class="page-header">
		<h1>Library</h1>
		<span class="muted count">{count}</span>
	</div>

	<div class="switch" role="tablist" aria-label="Library kind">
		<button
			role="tab"
			aria-selected={mode === 'series'}
			class="seg"
			class:active={mode === 'series'}
			onclick={() => (mode = 'series')}
		>
			Series
		</button>
		<button
			role="tab"
			aria-selected={mode === 'movies'}
			class="seg"
			class:active={mode === 'movies'}
			onclick={() => (mode = 'movies')}
		>
			Movies
		</button>
	</div>

	{#if mode === 'series'}
		<div class="filters" role="tablist" aria-label="Filter by status">
			{#each ['all', ...data.statuses] as status (status)}
				<button
					role="tab"
					aria-selected={activeStatus === status}
					class="chip"
					class:active={activeStatus === status}
					onclick={() => (activeStatus = status)}
				>
					{labels[status] ?? status}
				</button>
			{/each}
		</div>

		<ul class="legend" aria-label="Status colour legend">
			<li><span class="dot yellow"></span>Watching</li>
			<li><span class="dot green"></span>Up to date</li>
			<li><span class="dot purple"></span>Ended</li>
			<li><span class="dot neutral"></span>Unknown</li>
		</ul>

		{#if favorites.length > 0 && activeStatus === 'all'}
			<h2 class="section-title">★ Favorites</h2>
			<div class="grid">
				{#each favorites as s (s.showId)}
					<ShowCard
						href={`/show/${s.showId}`}
						title={s.name}
						posterPath={s.posterPath}
						favorite={true}
						color={s.color}
						subtitle={`${s.watchedEpisodes} watched`}
					/>
				{/each}
			</div>
		{/if}

		{#if filtered.length === 0}
			<div class="empty">No shows here yet.</div>
		{:else}
			<h2 class="section-title">{labels[activeStatus] ?? activeStatus}</h2>
			<div class="grid">
				{#each filtered as s (s.showId)}
					<ShowCard
						href={`/show/${s.showId}`}
						title={s.name}
						posterPath={s.posterPath}
						favorite={s.isFavorite}
						color={s.color}
						subtitle={`${s.watchedEpisodes} watched`}
					/>
				{/each}
			</div>
		{/if}
	{:else if data.movies.length === 0}
		<div class="empty">No movies yet — mark a film as watched to see it here.</div>
	{:else}
		<div class="grid">
			{#each data.movies as m (m.movieId)}
				<ShowCard
					href={`/movie/${m.movieId}`}
					title={m.title}
					posterPath={m.posterPath}
					badge={m.watchCount > 1 ? `×${m.watchCount}` : null}
					subtitle="Watched"
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.count {
		margin-left: auto;
		font-size: 0.85rem;
	}

	.switch {
		display: flex;
		gap: 4px;
		padding: 4px;
		margin-bottom: 12px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 999px;
	}

	.seg {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text);
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 0.9rem;
		font-weight: 600;
		min-height: 40px;
	}

	.seg.active {
		background: var(--accent);
		color: var(--accent-contrast);
	}

	.filters {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 8px;
		margin-bottom: 8px;
		scrollbar-width: none;
	}

	.filters::-webkit-scrollbar {
		display: none;
	}

	.chip {
		flex-shrink: 0;
		border: 1px solid var(--border);
		background: var(--bg-elev);
		color: var(--text);
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 0.85rem;
		font-weight: 600;
		min-height: 40px;
	}

	.chip.active {
		background: var(--accent);
		color: var(--accent-contrast);
		border-color: var(--accent);
	}

	.section-title {
		font-size: 1rem;
		margin: 16px 0 10px;
	}

	.legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		padding: 0;
		margin: 0 0 8px;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.legend .dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.legend .dot.yellow {
		background: #f5b301;
	}

	.legend .dot.green {
		background: #22a565;
	}

	.legend .dot.purple {
		background: #a24bd6;
	}

	.legend .dot.neutral {
		background: #9aa0a6;
	}
</style>
