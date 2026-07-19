<script lang="ts">
	import BackButton from '$lib/components/BackButton.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Board = 'all-time' | 'month';
	let board = $state<Board>('all-time');

	function hoursOf(minutes: number): number {
		return Math.round(minutes / 60);
	}

	// Ranked view for the active board. All-time ranks by total minutes; the
	// monthly board ranks by this month's minutes.
	const ranked = $derived(
		[...data.entries]
			.sort((a, b) =>
				board === 'all-time'
					? b.minutesWatched - a.minutesWatched
					: b.monthMinutes - a.monthMinutes
			)
			.map((e, i) => ({ ...e, rank: i + 1 }))
	);

	const myRank = $derived(ranked.find((e) => e.isSelf)?.rank ?? null);

	const boards: { key: Board; label: string }[] = [
		{ key: 'all-time', label: 'All time' },
		{ key: 'month', label: 'This month' }
	];
</script>

<div class="page">
	<div class="page-header">
		<BackButton />
		<h1>Leaderboard</h1>
	</div>

	<div class="switch" role="tablist" aria-label="Leaderboard period">
		{#each boards as b (b.key)}
			<button
				role="tab"
				aria-selected={board === b.key}
				class="seg"
				class:active={board === b.key}
				onclick={() => (board = b.key)}
			>
				{b.label}
			</button>
		{/each}
	</div>

	{#if myRank}
		<p class="my-rank muted">
			You're ranked <strong>#{myRank}</strong> of {ranked.length}
			{board === 'all-time' ? 'all time' : 'this month'}.
		</p>
	{/if}

	<ol class="board">
		{#each ranked as e (e.id)}
			{@const minutes = board === 'all-time' ? e.minutesWatched : e.monthMinutes}
			{@const episodes = board === 'all-time' ? e.episodesWatched : e.monthEpisodes}
			<li class="row" class:self={e.isSelf}>
				<a class="row-link" href={`/community/${e.id}`}>
					<span class="rank" class:top={e.rank <= 3}>{e.rank}</span>
					<span class="name">
						{e.displayName}
						{#if e.isSelf}<span class="you-badge">You</span>{/if}
					</span>
					<span class="stat">
						<span class="stat-num">{hoursOf(minutes).toLocaleString()}h</span>
						<span class="muted stat-sub">{episodes.toLocaleString()} ep</span>
					</span>
				</a>
			</li>
		{/each}
	</ol>
</div>

<style>
	.page-header {
		display: flex;
		align-items: center;
		gap: 6px;
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

	.my-rank {
		font-size: 0.85rem;
		margin: 0 0 12px;
	}

	.board {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.row-link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-height: 44px;
	}

	.row.self .row-link {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev));
	}

	.rank {
		width: 28px;
		text-align: center;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.rank.top {
		color: var(--accent);
	}

	.name {
		flex: 1;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.you-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		background: var(--accent);
		color: var(--accent-contrast);
		padding: 1px 6px;
		border-radius: 999px;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex-shrink: 0;
	}

	.stat-num {
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	.stat-sub {
		font-size: 0.7rem;
	}
</style>
