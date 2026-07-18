<script lang="ts">
	import { tmdbImage } from '$lib/tmdb-image';
	import type { WatchProviders } from '$lib/server/tmdb';

	let { providers }: { providers: WatchProviders } = $props();

	const groups = $derived(
		[
			{ label: 'Stream', items: providers.flatrate },
			{ label: 'Rent', items: providers.rent },
			{ label: 'Buy', items: providers.buy }
		].filter((g) => g.items.length > 0)
	);

	const hasAny = $derived(groups.length > 0);
</script>

<section class="wtw">
	<h2>Where to Watch</h2>

	{#if hasAny}
		{#each groups as group (group.label)}
			<div class="group">
				<span class="muted group-label">{group.label}</span>
				<ul class="logos">
					{#each group.items as p (p.id)}
						<li>
							{#if tmdbImage(p.logoPath, 'w92')}
								<img
									class="logo"
									src={tmdbImage(p.logoPath, 'w92')}
									alt={p.name}
									title={p.name}
									loading="lazy"
								/>
							{:else}
								<span class="logo ph" title={p.name}>{p.name.slice(0, 2)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{:else}
		<p class="muted empty">Not available to stream in {providers.region}.</p>
	{/if}
</section>

<style>
	.wtw {
		margin: 24px 0;
	}

	.wtw h2 {
		font-size: 1.05rem;
		margin: 0 0 12px;
	}

	.group {
		margin-bottom: 14px;
	}

	.group-label {
		display: block;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 8px;
	}

	.logos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.logo {
		width: 46px;
		height: 46px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		border: 1px solid var(--border);
		background: var(--bg-elev);
		display: block;
	}

	.logo.ph {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
	}

	.empty {
		font-size: 0.9rem;
		margin: 0;
	}
</style>
