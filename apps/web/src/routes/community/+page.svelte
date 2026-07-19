<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function initials(name: string): string {
		return name.replace(/^User #/, '#').slice(0, 2).toUpperCase();
	}

	function hoursOf(minutes: number): number {
		return Math.round(minutes / 60);
	}
</script>

<div class="page">
	<div class="page-header">
		<h1>Community</h1>
		<span class="muted count">{data.members.length} members</span>
	</div>

	<a class="leaderboard-link" href="/community/leaderboard">
		<span class="lb-icon" aria-hidden="true">🏆</span>
		<span class="lb-text">
			<span class="lb-title">Leaderboard</span>
			<span class="muted lb-sub">Top viewers by hours & episodes</span>
		</span>
		<span class="chevron" aria-hidden="true">›</span>
	</a>

	<ul class="members">
		{#each data.members as m (m.id)}
			<li>
				<a class="member" href={`/community/${m.id}`}>
					<span class="avatar" aria-hidden="true">{initials(m.displayName)}</span>
					<span class="who">
						<span class="name">
							{m.displayName}
							{#if m.isSelf}<span class="you-badge">You</span>{/if}
						</span>
						<span class="muted sub">
							{m.showsFollowed.toLocaleString()} shows · {m.moviesWatched.toLocaleString()} movies
						</span>
					</span>
					<span class="headline">
						<span class="h-num">{hoursOf(m.minutesWatched).toLocaleString()}</span>
						<span class="muted h-unit">hours</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</div>

<style>
	.count {
		margin-left: auto;
		font-size: 0.85rem;
	}

	.leaderboard-link {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 16px;
		min-height: 44px;
	}

	.lb-icon {
		font-size: 1.4rem;
	}

	.lb-text {
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	.lb-title {
		font-weight: 600;
	}

	.lb-sub {
		font-size: 0.8rem;
	}

	.chevron {
		color: var(--text-muted);
		font-size: 1.4rem;
	}

	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.member {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-height: 44px;
	}

	.avatar {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-contrast);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 0.95rem;
		flex-shrink: 0;
	}

	.who {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.name {
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
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

	.sub {
		font-size: 0.78rem;
	}

	.headline {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex-shrink: 0;
	}

	.h-num {
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		font-size: 1.1rem;
	}

	.h-unit {
		font-size: 0.7rem;
	}
</style>
