<script lang="ts">
	import { enhance } from '$app/forms';
	import { tmdbImage } from '$lib/tmdb-image';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function code(s: number, e: number): string {
		return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
	}
</script>

{#snippet section(title: string, items: PageData['upNext'])}
	<section class="up-next-section">
		<h2 class="section-title">{title}</h2>
		<ul class="up-next-list">
			{#each items as item (item.show.id)}
				{@const poster = tmdbImage(item.show.posterPath, 'w185')}
				<li class="card up-next-card">
					<a class="thumb" href={`/show/${item.show.id}`}>
						{#if poster}
							<img src={poster} alt={item.show.name} loading="lazy" />
						{:else}
							<div class="ph" aria-hidden="true">{item.show.name.slice(0, 1)}</div>
						{/if}
					</a>
					<div class="body">
						<a href={`/show/${item.show.id}`} class="show-name">{item.show.name}</a>
						<span class="ep-code muted">{code(item.episode.seasonNumber, item.episode.episodeNumber)}</span>
						<span class="ep-name">{item.episode.name}</span>
					</div>
					<form
						method="POST"
						action="?/markWatched"
						use:enhance={() => async ({ update }) => update()}
					>
						<input type="hidden" name="episodeId" value={item.episode.id} />
						<button class="btn btn-accent watch-btn" type="submit" aria-label="Mark watched">
							✓
						</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<div class="page">
	<div class="page-header">
		<h1>Up Next</h1>
	</div>

	{#if data.upNext.length === 0 && data.stale.length === 0}
		<div class="empty">
			<p>You're all caught up. 🎉</p>
			<p class="muted">Follow a show from Search to see your next episodes here.</p>
			<a class="btn btn-accent" href="/search">Find something to watch</a>
		</div>
	{:else}
		{#if data.upNext.length > 0}
			{@render section('Up Next', data.upNext)}
		{/if}
		{#if data.stale.length > 0}
			{@render section("Haven't watched in a while", data.stale)}
		{/if}
	{/if}
</div>

<style>
	.up-next-section + .up-next-section {
		margin-top: 28px;
	}

	.section-title {
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 12px;
		color: var(--text-muted);
	}

	.up-next-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.up-next-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px;
	}

	.thumb {
		width: 54px;
		aspect-ratio: 2 / 3;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-elev-2);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.ph {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: var(--text-muted);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.show-name {
		font-weight: 700;
		font-size: 0.95rem;
	}

	.ep-code {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}

	.ep-name {
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.watch-btn {
		width: 48px;
		flex-shrink: 0;
		font-size: 1.2rem;
	}

	.empty .btn {
		margin-top: 16px;
	}
</style>
