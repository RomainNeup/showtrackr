<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import { tmdbImage } from '$lib/tmdb-image';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const followed = $derived(new Set(data.followedTmdbIds));

	// Debounced search updates the URL (?q=…) which re-runs the load function.
	function runSearch(query: string) {
		const target = query ? `/search?q=${encodeURIComponent(query)}` : '/search';
		goto(target, { keepFocus: true, replaceState: true, noScroll: true });
	}
</script>

<div class="page">
	<div class="page-header">
		<h1>Search</h1>
	</div>

	<SearchBar value={data.q} onSearch={runSearch} />

	{#if data.q && data.results.length === 0}
		<div class="empty">No results for “{data.q}”.</div>
	{/if}

	<ul class="results">
		{#each data.results as r (r.type + r.tmdbId)}
			{@const poster = tmdbImage(r.posterPath, 'w185')}
			<li class="card result">
				<!--
					The whole card is the "open" trigger. Search results are TMDB
					entries that may not exist in the local catalog yet, and the
					detail routes key off the LOCAL id — so we can't link straight
					to a TMDB id. The open/openMovie action does the cache-through
					(ensureShow/ensureMovie) then redirects to /show|movie/[localId].
					use:enhance keeps it a client-side transition; its default
					handler already follows the server redirect.
				-->
				<form
					method="POST"
					action={r.type === 'show' ? '?/open' : '?/openMovie'}
					use:enhance
					class="open-form"
				>
					<input type="hidden" name="tmdbId" value={r.tmdbId} />
					<button type="submit" class="card-trigger" aria-label={`Open ${r.title}`}>
						<span class="thumb">
							{#if poster}
								<img src={poster} alt="" loading="lazy" />
							{:else}
								<span class="ph" aria-hidden="true">{r.title.slice(0, 1)}</span>
							{/if}
						</span>
						<span class="body">
							<span class="title">{r.title}</span>
							<span class="meta muted">
								{r.type === 'show' ? '📺 Show' : '🎬 Movie'}
								{#if r.year}· {r.year}{/if}
							</span>
							{#if r.overview}<span class="overview muted">{r.overview}</span>{/if}
						</span>
					</button>
				</form>

				<!-- Secondary action: follow a show. Sibling form (not nested) so the
				     markup stays valid; positioned in the card corner. -->
				{#if r.type === 'show'}
					{#if !followed.has(r.tmdbId)}
						<form method="POST" action="?/follow" use:enhance class="follow-form">
							<input type="hidden" name="tmdbId" value={r.tmdbId} />
							<button class="follow-btn" type="submit" aria-label={`Follow ${r.title}`}>
								<span aria-hidden="true">＋</span>
							</button>
						</form>
					{:else}
						<span class="following" aria-label={`Following ${r.title}`}>
							<span aria-hidden="true">✓</span>
						</span>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.results {
		list-style: none;
		padding: 0;
		margin: 16px 0 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.result {
		position: relative;
		padding: 0;
		overflow: hidden;
	}

	/* The whole card is a submit button styled to look like a row. */
	.open-form {
		margin: 0;
	}

	.card-trigger {
		display: flex;
		gap: 12px;
		align-items: stretch;
		width: 100%;
		/* Reserve the top-right corner for the follow/following control. */
		padding: 10px 52px 10px 10px;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: inherit;
	}

	.card-trigger:hover {
		background: var(--bg-elev-2);
	}

	.card-trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.thumb {
		display: block;
		width: 60px;
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
		gap: 3px;
	}

	.title {
		display: block;
	}

	.title {
		font-weight: 700;
		font-size: 0.95rem;
	}

	.meta {
		font-size: 0.78rem;
	}

	.overview {
		font-size: 0.78rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Secondary follow / following control, pinned to the card's top-right. */
	.follow-form {
		position: absolute;
		top: 8px;
		right: 8px;
		margin: 0;
		z-index: 2;
	}

	.follow-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border: none;
		border-radius: 50%;
		background: var(--bg-elev-2);
		color: var(--text);
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
	}

	.follow-btn:hover {
		background: var(--accent);
		color: var(--accent-contrast);
	}

	.follow-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.following {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		color: var(--success);
		font-weight: 700;
		font-size: 1.1rem;
	}
</style>
