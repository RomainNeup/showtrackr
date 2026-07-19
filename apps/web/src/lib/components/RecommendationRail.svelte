<script lang="ts">
	import { tmdbImage } from '$lib/tmdb-image';

	type Rec = { tmdbId: number; name: string; posterPath: string | null };

	type Props = {
		/** Recommendation cards to show. */
		items: Rec[];
		/** Form action that caches the TMDB title locally then redirects to its page. */
		action: string;
		/** Section heading. */
		heading?: string;
	};

	let { items, action, heading = 'More like this' }: Props = $props();
</script>

{#if items.length}
	<section class="recs" aria-label={heading}>
		<h2 class="recs-heading">{heading}</h2>
		<div class="rail">
			{#each items as rec (rec.tmdbId)}
				{@const poster = tmdbImage(rec.posterPath, 'w342')}
				<form method="POST" {action} class="rec-form">
					<input type="hidden" name="tmdbId" value={rec.tmdbId} />
					<button class="rec-card" type="submit" title={rec.name}>
						<span class="poster">
							{#if poster}
								<img src={poster} alt={rec.name} loading="lazy" />
							{:else}
								<span class="placeholder" aria-hidden="true">{rec.name.slice(0, 1)}</span>
							{/if}
						</span>
						<span class="title">{rec.name}</span>
					</button>
				</form>
			{/each}
		</div>
	</section>
{/if}

<style>
	.recs {
		margin-top: 24px;
	}

	.recs-heading {
		font-size: 1.05rem;
		margin: 0 0 12px;
	}

	.rail {
		display: flex;
		gap: 12px;
		overflow-x: auto;
		scroll-snap-type: x proximity;
		/* Stay within the page content width (matches the .page 16px inset); the
		   rail scrolls horizontally inside those bounds rather than full-bleed. */
		padding-bottom: 4px;
		-webkit-overflow-scrolling: touch;
	}

	.rec-form {
		flex: 0 0 auto;
		scroll-snap-align: start;
	}

	.rec-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 108px;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}

	.poster {
		position: relative;
		display: block;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-elev-2);
	}

	.poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	.title {
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.rec-card:focus-visible .poster {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
