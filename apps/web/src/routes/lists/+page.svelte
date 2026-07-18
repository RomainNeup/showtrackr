<script lang="ts">
	import ShowCard from '$lib/components/ShowCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="page">
	<div class="page-header">
		<h1>Lists</h1>
	</div>

	<section class="block">
		<h2 class="section-title">★ Favorite shows</h2>
		{#if data.favorites.length === 0}
			<p class="muted">No favorites yet — tap ☆ on a show to add it.</p>
		{:else}
			<div class="grid">
				{#each data.favorites as f (f.showId)}
					<ShowCard href={`/show/${f.showId}`} title={f.name} posterPath={f.posterPath} favorite />
				{/each}
			</div>
		{/if}
	</section>

	<section class="block">
		<h2 class="section-title">Your lists</h2>
		{#if data.lists.length === 0}
			<p class="muted">No custom lists yet. Imported lists from your TV Time export appear here.</p>
		{:else}
			<ul class="list-index">
				{#each data.lists as l (l.id)}
					<li class="card list-row">
						<span class="list-name">{l.name}</span>
						<span class="muted list-count">{l.itemCount} items</span>
						{#if l.type === 'collection'}<span class="tag">collection</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.block {
		margin-bottom: 28px;
	}

	.section-title {
		font-size: 1rem;
		margin: 0 0 12px;
	}

	.list-index {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.list-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px;
	}

	.list-name {
		font-weight: 600;
	}

	.list-count {
		margin-left: auto;
		font-size: 0.85rem;
	}

	.tag {
		background: var(--bg-elev-2);
		color: var(--text-muted);
		font-size: 0.7rem;
		padding: 2px 8px;
		border-radius: 999px;
	}
</style>
