<script lang="ts">
	import { enhance } from '$app/forms';
	import BackButton from '$lib/components/BackButton.svelte';
	import RatingControl from '$lib/components/RatingControl.svelte';
	import RecommendationRail from '$lib/components/RecommendationRail.svelte';
	import WhereToWatch from '$lib/components/WhereToWatch.svelte';
	import { tmdbImage } from '$lib/tmdb-image';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const poster = $derived(tmdbImage(data.movie.posterPath, 'w342'));
</script>

<div class="page movie-page">
	<BackButton overlay />
	<div class="header-row">
		{#if poster}
			<img class="poster" src={poster} alt={data.movie.title} />
		{:else}
			<div class="poster ph" aria-hidden="true">{data.movie.title.slice(0, 1)}</div>
		{/if}
		<div class="meta">
			<h1>{data.movie.title}</h1>
			<p class="muted">
				{#if data.movie.releaseDate}{data.movie.releaseDate.slice(0, 4)}{/if}
				{#if data.movie.runtimeMin}· {data.movie.runtimeMin} min{/if}
				{#if data.watchCount > 1}<span class="rewatch-badge" title="Watched {data.watchCount} times">×{data.watchCount}</span>{/if}
			</p>
			<div class="rate">
				<span class="muted rate-label">Your rating</span>
				<RatingControl
					idField="movieId"
					idValue={data.movie.id}
					value={data.rating}
					action="?/rate"
					compact={false}
				/>
			</div>
		</div>
	</div>

	<form method="POST" action="?/toggleWatched" use:enhance={() => async ({ update }) => update()}>
		<input type="hidden" name="watched" value={data.watched ? '' : 'on'} />
		<button class="btn btn-block" class:btn-accent={!data.watched} type="submit">
			{data.watched ? '✓ Watched — mark unwatched' : 'Mark as watched'}
		</button>
	</form>

	{#if data.watched}
		<form
			method="POST"
			action="?/rewatch"
			class="rewatch-form"
			use:enhance={() => async ({ update }) => update()}
		>
			<button class="btn btn-block" type="submit">
				↻ Rewatch{data.watchCount > 1 ? ` (×${data.watchCount})` : ''}
			</button>
		</form>
	{/if}

	{#if data.movie.overview}
		<p class="overview">{data.movie.overview}</p>
	{/if}

	{#if data.providers}
		<WhereToWatch providers={data.providers} />
	{/if}

	<RecommendationRail items={data.recommendations} action="?/openMovie" />
</div>

<style>
	.movie-page {
		position: relative;
	}

	.header-row {
		display: flex;
		gap: 16px;
		/* Clear the overlay BackButton (top-left, notch-safe) so it floats above
		   the poster/title row instead of covering the poster. */
		margin-top: calc(env(safe-area-inset-top, 0px) + 40px);
		margin-bottom: 16px;
	}

	.poster {
		width: 120px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.poster.ph {
		aspect-ratio: 2 / 3;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-elev-2);
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	.meta h1 {
		font-size: 1.3rem;
		margin: 0 0 4px;
	}

	.rate {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.rate-label {
		font-size: 0.78rem;
	}

	.overview {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--text-muted);
		margin-top: 16px;
	}

	.rewatch-form {
		margin-top: 8px;
	}

	.rewatch-badge {
		display: inline-block;
		font-size: 0.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		background: var(--bg-elev-2);
		border-radius: 999px;
		padding: 1px 8px;
		margin-left: 4px;
	}
</style>
