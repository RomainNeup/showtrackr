<script lang="ts">
	import { enhance } from '$app/forms';
	import EpisodeRow from '$lib/components/EpisodeRow.svelte';
	import WhereToWatch from '$lib/components/WhereToWatch.svelte';
	import { tmdbImage } from '$lib/tmdb-image';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const backdrop = $derived(tmdbImage(data.show.backdropPath, 'w780'));
	const poster = $derived(tmdbImage(data.show.posterPath, 'w342'));

	function watchedInSeason(s: (typeof data.seasons)[number]): number {
		return s.episodes.filter((e) => e.watched).length;
	}

	// Expand the first regular season you haven't finished (where you left off);
	// fall back to the first regular season, then anything. Never default to Specials (season 0).
	function defaultOpenSeason(): number | null {
		const regular = data.seasons.filter((s) => s.seasonNumber > 0);
		const inProgress = regular.find((s) => watchedInSeason(s) < s.episodes.length);
		return (inProgress ?? regular[0] ?? data.seasons[0])?.seasonNumber ?? null;
	}

	// Which season section is expanded.
	let openSeason = $state<number | null>(defaultOpenSeason());
</script>

<div class="show-page">
	<header class="hero">
		{#if backdrop}
			<img class="backdrop" src={backdrop} alt="" aria-hidden="true" />
		{/if}
		<div class="hero-content">
			{#if poster}
				<img class="poster" src={poster} alt={data.show.name} />
			{/if}
			<div class="hero-meta">
				<h1>{data.show.name}</h1>
				<p class="muted sub">
					{#if data.show.network}{data.show.network} · {/if}
					{#if data.show.status}{data.show.status}{/if}
					{#if data.show.firstAirDate}· {data.show.firstAirDate.slice(0, 4)}{/if}
				</p>
			</div>
		</div>
	</header>

	<div class="page">
		<!-- Follow / status controls -->
		<div class="follow-bar">
			{#if data.follow}
				<form method="POST" action="?/setStatus" use:enhance={() => async ({ update }) => update()}>
					<select name="status" value={data.follow.status} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
						<option value="watching">Watching</option>
						<option value="upcoming">Upcoming</option>
						<option value="stopped">Stopped</option>
						<option value="archived">Archived</option>
					</select>
				</form>
				<form method="POST" action="?/toggleFavorite" use:enhance={() => async ({ update }) => update()}>
					<input type="hidden" name="isFavorite" value={data.follow.isFavorite ? '' : 'on'} />
					<button class="btn fav-btn" class:on={data.follow.isFavorite} type="submit">
						{data.follow.isFavorite ? '★ Favorite' : '☆ Favorite'}
					</button>
				</form>
				<form method="POST" action="?/unfollow" use:enhance={() => async ({ update }) => update()}>
					<button class="btn" type="submit">Unfollow</button>
				</form>
			{:else}
				<form method="POST" action="?/follow" use:enhance={() => async ({ update }) => update()}>
					<button class="btn btn-accent btn-block" type="submit">+ Follow</button>
				</form>
			{/if}
		</div>

		{#if data.show.overview}
			<p class="overview">{data.show.overview}</p>
		{/if}

		{#if data.providers}
			<WhereToWatch providers={data.providers} />
		{/if}

		<div class="mark-all">
			<form method="POST" action="?/markAll" use:enhance={() => async ({ update }) => update()}>
				<button class="btn" type="submit">✓ Mark whole show watched</button>
			</form>
			<form method="POST" action="?/rewatchAll" use:enhance={() => async ({ update }) => update()}>
				<button class="btn" type="submit">↻ Rewatch whole show</button>
			</form>
		</div>

		<!-- Seasons -->
		{#each data.seasons as season (season.seasonNumber)}
			<section class="season">
				<button
					class="season-header"
					onclick={() => (openSeason = openSeason === season.seasonNumber ? null : season.seasonNumber)}
					aria-expanded={openSeason === season.seasonNumber}
				>
					<span class="season-name">{season.name}</span>
					<span class="muted season-count">
						{watchedInSeason(season)}/{season.episodes.length}
					</span>
					<span class="chevron" aria-hidden="true">
						{openSeason === season.seasonNumber ? '▾' : '▸'}
					</span>
				</button>

				{#if openSeason === season.seasonNumber}
					<div class="season-body">
						<div class="season-actions">
							<form method="POST" action="?/markSeason" use:enhance={() => async ({ update }) => update()}>
								<input type="hidden" name="seasonNumber" value={season.seasonNumber} />
								<button class="btn small" type="submit">Mark season watched</button>
							</form>
							<form method="POST" action="?/rewatchSeason" use:enhance={() => async ({ update }) => update()}>
								<input type="hidden" name="seasonNumber" value={season.seasonNumber} />
								<button class="btn small" type="submit">↻ Rewatch season</button>
							</form>
						</div>
						{#each season.episodes as ep (ep.id)}
							<EpisodeRow
								episodeId={ep.id}
								seasonNumber={ep.seasonNumber}
								episodeNumber={ep.episodeNumber}
								name={ep.name}
								airDate={ep.airDate}
								runtimeMin={ep.runtimeMin}
								watched={ep.watched}
								watchCount={ep.watchCount}
								rating={ep.rating}
							/>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	</div>
</div>

<style>
	.hero {
		position: relative;
		overflow: hidden;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0.25;
		filter: blur(1px);
	}

	.hero-content {
		position: relative;
		display: flex;
		gap: 16px;
		padding: 20px 16px;
		align-items: flex-end;
		background: linear-gradient(to top, var(--bg) 10%, transparent);
	}

	.poster {
		width: 92px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.hero-meta h1 {
		font-size: 1.35rem;
		margin: 0 0 4px;
	}

	.sub {
		font-size: 0.85rem;
	}

	.follow-bar {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 16px;
	}

	.follow-bar form {
		display: flex;
	}

	select {
		height: 44px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elev);
		color: var(--text);
		padding: 0 10px;
	}

	.fav-btn.on {
		color: var(--star);
		border-color: var(--star);
	}

	.overview {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--text-muted);
		margin: 0 0 16px;
	}

	.mark-all {
		margin-bottom: 16px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.season-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin: 10px 0;
	}

	.season {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 12px;
		overflow: hidden;
	}

	.season-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px;
		background: var(--bg-elev);
		border: none;
		color: var(--text);
		font-weight: 700;
		min-height: 52px;
	}

	.season-count {
		margin-left: auto;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.season-body {
		padding: 0 14px 8px;
	}

	.btn.small {
		min-height: 38px;
		font-size: 0.85rem;
	}
</style>
