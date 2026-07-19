<script lang="ts">
	import BackButton from '$lib/components/BackButton.svelte';
	import ShowCard from '$lib/components/ShowCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function hoursOf(minutes: number): number {
		return Math.round(minutes / 60);
	}

	// Each row: label + my value + their value. `max` scales the dual bars.
	const rows = $derived([
		{ label: 'Hours', mine: hoursOf(data.me.minutes), theirs: hoursOf(data.them.minutes) },
		{ label: 'Episodes', mine: data.me.episodes, theirs: data.them.episodes },
		{ label: 'Movies', mine: data.me.movies, theirs: data.them.movies },
		{ label: 'Shows followed', mine: data.me.shows, theirs: data.them.shows }
	]);
</script>

<div class="page">
	<div class="page-header">
		<BackButton />
		<h1>Compare</h1>
	</div>

	<div class="match-card">
		<div class="match-num">{data.tasteMatch}%</div>
		<div class="muted match-label">taste match with {data.them.displayName}</div>
		<div class="match-bar" aria-hidden="true">
			<div class="match-fill" style={`width: ${data.tasteMatch}%`}></div>
		</div>
	</div>

	<div class="legend">
		<span><span class="swatch you"></span>You</span>
		<span><span class="swatch them"></span>{data.them.displayName}</span>
	</div>

	<section class="block">
		{#each rows as r (r.label)}
			{@const max = Math.max(1, r.mine, r.theirs)}
			<div class="cmp-row">
				<div class="cmp-label">{r.label}</div>
				<div class="cmp-bars">
					<div class="cmp-line">
						<div class="cmp-bar you" style={`width: ${(r.mine / max) * 100}%`}></div>
						<span class="cmp-val">{r.mine.toLocaleString()}</span>
					</div>
					<div class="cmp-line">
						<div class="cmp-bar them" style={`width: ${(r.theirs / max) * 100}%`}></div>
						<span class="cmp-val">{r.theirs.toLocaleString()}</span>
					</div>
				</div>
			</div>
		{/each}
	</section>

	<section class="block">
		<h2 class="section-title">Shared shows ({data.sharedShows.length})</h2>
		{#if data.sharedShows.length === 0}
			<p class="muted">No shows in common yet.</p>
		{:else}
			<div class="grid">
				{#each data.sharedShows as s (s.showId)}
					<ShowCard href={`/show/${s.showId}`} title={s.name} posterPath={s.posterPath} />
				{/each}
			</div>
		{/if}
	</section>

	<section class="block">
		<h2 class="section-title">Shared movies ({data.sharedMovies.length})</h2>
		{#if data.sharedMovies.length === 0}
			<p class="muted">No movies in common yet.</p>
		{:else}
			<div class="grid">
				{#each data.sharedMovies as m (m.movieId)}
					<ShowCard href={`/movie/${m.movieId}`} title={m.title} posterPath={m.posterPath} />
				{/each}
			</div>
		{/if}
	</section>

	<section class="block">
		<h2 class="section-title">They follow that you don't</h2>
		{#if data.recommendations.length === 0}
			<p class="muted">Nothing new here — you already follow everything they do.</p>
		{:else}
			<p class="muted rec-hint">Lightweight recommendations from {data.them.displayName}.</p>
			<div class="grid">
				{#each data.recommendations as s (s.showId)}
					<ShowCard href={`/show/${s.showId}`} title={s.name} posterPath={s.posterPath} />
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

	.match-card {
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 20px;
		text-align: center;
		margin-bottom: 16px;
	}

	.match-num {
		font-size: 2.6rem;
		font-weight: 800;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.match-label {
		font-size: 0.85rem;
		margin-top: 4px;
	}

	.match-bar {
		margin-top: 14px;
		height: 8px;
		border-radius: 999px;
		background: var(--bg-elev-2, #333);
		overflow: hidden;
	}

	.match-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
	}

	.legend {
		display: flex;
		gap: 18px;
		justify-content: center;
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-bottom: 14px;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		display: inline-block;
	}

	.swatch.you {
		background: var(--accent);
	}

	.swatch.them {
		background: #8a8f98;
	}

	.block {
		margin-bottom: 28px;
	}

	.cmp-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}

	.cmp-label {
		width: 96px;
		flex-shrink: 0;
		font-weight: 600;
		font-size: 0.85rem;
	}

	.cmp-bars {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.cmp-line {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.cmp-bar {
		height: 12px;
		border-radius: 999px;
		min-width: 2px;
	}

	.cmp-bar.you {
		background: var(--accent);
	}

	.cmp-bar.them {
		background: #8a8f98;
	}

	.cmp-val {
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.section-title {
		font-size: 1rem;
		margin: 0 0 12px;
	}

	.rec-hint {
		font-size: 0.8rem;
		margin: 0 0 12px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}
</style>
