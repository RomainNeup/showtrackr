<script lang="ts">
	import { enhance } from '$app/forms';
	import RatingControl from './RatingControl.svelte';

	type Props = {
		episodeId: number;
		seasonNumber: number;
		episodeNumber: number;
		name: string;
		airDate?: string | null;
		runtimeMin?: number | null;
		watched: boolean;
		watchCount?: number;
		rating?: number | null;
	};

	let {
		episodeId,
		seasonNumber,
		episodeNumber,
		name,
		airDate = null,
		runtimeMin = null,
		watched,
		watchCount = 0,
		rating = null
	}: Props = $props();

	// Optimistic local state; the form action persists the change on the server.
	let checked = $state(watched);
	let count = $state(watchCount);
	let pending = $state(false);
	let rewatchPending = $state(false);

	// Resync when the props change (e.g. after ?/markSeason, ?/rewatchSeason or
	// ?/markAll → update() refreshes the list; components are reused because the
	// each-block is keyed on ep.id, so without this the row would go stale).
	$effect(() => {
		checked = watched;
	});
	$effect(() => {
		count = watchCount;
	});

	const code = $derived(`S${pad(seasonNumber)}E${pad(episodeNumber)}`);
	const isUpcoming = $derived(airDate ? new Date(airDate) > new Date() : false);

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}
</script>

<div class="episode-row" class:watched={checked}>
	<form
		class="check-form"
		method="POST"
		action="?/toggleEpisode"
		use:enhance={() => {
			pending = true;
			checked = !checked; // optimistic
			return async ({ update, result }) => {
				await update({ reset: false });
				if (result.type === 'failure') checked = !checked; // revert
				pending = false;
			};
		}}
	>
		<input type="hidden" name="episodeId" value={episodeId} />
		<input type="hidden" name="watched" value={checked ? '' : 'on'} />
		<button
			type="submit"
			class="check"
			class:on={checked}
			disabled={pending}
			aria-pressed={checked}
			aria-label={checked ? `Mark ${code} unwatched` : `Mark ${code} watched`}
		>
			{checked ? '✓' : ''}
		</button>
	</form>

	<div class="info">
		<span class="line1">
			<span class="code muted">{code}</span>
			<span class="name">{name}</span>
			{#if count > 1}<span class="rewatch-badge" title="Watched {count} times">×{count}</span>{/if}
		</span>
		<span class="line2 muted">
			{#if isUpcoming}<span class="upcoming">Upcoming</span>{/if}
			{#if airDate}{airDate}{/if}
			{#if runtimeMin}· {runtimeMin} min{/if}
		</span>
	</div>

	{#if checked}
		<form
			method="POST"
			action="?/rewatchEpisode"
			use:enhance={() => {
				rewatchPending = true;
				count = Math.max(count, 1) + 1; // optimistic
				return async ({ update, result }) => {
					await update({ reset: false });
					if (result.type === 'failure') count = Math.max(count - 1, 1); // revert
					rewatchPending = false;
				};
			}}
		>
			<input type="hidden" name="episodeId" value={episodeId} />
			<button
				type="submit"
				class="rewatch"
				disabled={rewatchPending}
				aria-label={`Add a rewatch of ${code}`}
				title="Mark re-watched (+1)"
			>
				+1
			</button>
		</form>
	{/if}

	<RatingControl idField="episodeId" idValue={episodeId} value={rating} action="?/rateEpisode" />
</div>

<style>
	.episode-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}

	.episode-row.watched .name {
		color: var(--text-muted);
	}

	/* The wrapping form is the flex item in .episode-row; keep it from being
	   compressed on narrow screens so the circular button stays 1:1. */
	.check-form {
		flex-shrink: 0;
	}

	.check {
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		min-width: 30px;
		min-height: 30px;
		border-radius: 50%;
		border: 2px solid var(--border);
		background: transparent;
		color: transparent;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Row itself provides the 44px touch target via padding. */
	}

	.check.on {
		background: var(--success);
		border-color: var(--success);
		color: #fff;
	}

	.info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.line1 {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}

	.code {
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.name {
		font-size: 0.9rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.line2 {
		font-size: 0.75rem;
		display: flex;
		gap: 6px;
	}

	.upcoming {
		color: var(--accent);
		font-weight: 600;
	}

	.rewatch-badge {
		flex-shrink: 0;
		font-size: 0.72rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		background: var(--bg-elev-2);
		border-radius: 999px;
		padding: 1px 7px;
		line-height: 1.4;
	}

	.rewatch {
		flex-shrink: 0;
		min-width: 34px;
		height: 30px;
		min-height: 30px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0 8px;
	}

	.rewatch:disabled {
		opacity: 0.5;
	}
</style>
