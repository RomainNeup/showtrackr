<script lang="ts">
	import { tmdbImage } from '$lib/tmdb-image';

	/** TV Time-style Library status colour (kept as a local union so this client
	 * component never imports from `$lib/server`). Mirrors `ShowColor`. */
	type StatusColor = 'yellow' | 'green' | 'purple' | 'neutral';

	type Props = {
		href: string;
		title: string;
		posterPath?: string | null;
		subtitle?: string | null;
		favorite?: boolean;
		badge?: string | null;
		/** When set, renders a status dot indicating watch/production state. */
		color?: StatusColor | null;
	};

	let {
		href,
		title,
		posterPath = null,
		subtitle = null,
		favorite = false,
		badge = null,
		color = null
	}: Props = $props();

	const poster = $derived(tmdbImage(posterPath, 'w342'));

	const colorLabels: Record<StatusColor, string> = {
		yellow: 'Watching',
		green: 'Up to date',
		purple: 'Ended',
		neutral: 'Unknown'
	};
</script>

<a class="show-card" {href}>
	<div class="poster {color ?? ''}">
		{#if poster}
			<img src={poster} alt={title} loading="lazy" />
		{:else}
			<div class="placeholder" aria-hidden="true">{title.slice(0, 1)}</div>
		{/if}
		{#if color}
			<span class="status-pill {color}" aria-label="Status: {colorLabels[color]}">
				{colorLabels[color]}
			</span>
		{/if}
		{#if favorite}
			<span class="fav" title="Favorite" aria-label="Favorite">★</span>
		{/if}
		{#if badge}
			<span class="badge">{badge}</span>
		{/if}
	</div>
	<div class="meta">
		<span class="title">{title}</span>
		{#if subtitle}
			<span class="subtitle muted">{subtitle}</span>
		{/if}
	</div>
</a>

<style>
	.show-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-elev-2);
		box-sizing: border-box;
		/* Status colour is reinforced by a border around the whole poster for
		   at-a-glance scanning; transparent when there's no status. */
		border: 3px solid transparent;
	}

	.poster.yellow {
		border-color: #f5b301;
	}
	.poster.green {
		border-color: #1a9d5f;
	}
	.poster.purple {
		border-color: #9a3fd0;
	}
	.poster.neutral {
		border-color: #6b7075;
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
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	.status-pill {
		position: absolute;
		top: 6px;
		left: 6px;
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.2px;
		padding: 4px 8px;
		border-radius: 999px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
		max-width: calc(100% - 12px);
		white-space: nowrap;
	}

	/* Explicit colours (not theme tokens) so the semantics are stable across
	   light/dark; text colour chosen for contrast on each background. */
	.status-pill.yellow {
		background: #f5b301;
		color: #1a1a1a;
	}

	.status-pill.green {
		background: #1a9d5f;
		color: #fff;
	}

	.status-pill.purple {
		background: #9a3fd0;
		color: #fff;
	}

	.status-pill.neutral {
		background: #6b7075;
		color: #fff;
	}

	.fav {
		position: absolute;
		top: 6px;
		right: 6px;
		color: var(--star);
		font-size: 1.1rem;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
	}

	.badge {
		position: absolute;
		bottom: 6px;
		left: 6px;
		background: var(--accent);
		color: var(--accent-contrast);
		font-size: 0.7rem;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 999px;
	}

	.title {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.subtitle {
		font-size: 0.75rem;
	}
</style>
