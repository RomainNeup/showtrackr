<script lang="ts">
	import { enhance } from '$app/forms';

	type Props = {
		/** Current rating (1..MAX) or null/0 when unrated. */
		value?: number | null;
		/** Form action to POST the rating to (e.g. "?/rateEpisode"). */
		action: string;
		/** Hidden field carrying the entity id (e.g. "episodeId" | "movieId"). */
		idField: string;
		idValue: number;
		ratingField?: string;
		compact?: boolean;
	};

	let {
		value = null,
		action,
		idField,
		idValue,
		ratingField = 'rating',
		compact = true
	}: Props = $props();

	// 5-star scale (frozen in CONTRACT: ratings are 1..5 app-wide).
	const MAX = 5;
	let current = $state(value ?? 0);
	let submitValue = $state(0);

	// Resync when the server-provided `value` changes (component is reused across
	// list re-renders after a mutation → update()).
	$effect(() => {
		current = value ?? 0;
	});

	function submitRating(form: HTMLFormElement, next: number) {
		submitValue = next;
		current = next;
		form.requestSubmit();
	}
</script>

<form
	class="rating"
	class:compact
	method="POST"
	{action}
	use:enhance={() => {
		return async ({ update }) => update({ reset: false });
	}}
>
	<input type="hidden" name={idField} value={idValue} />
	<input type="hidden" name={ratingField} value={submitValue} />
	{#each Array.from({ length: MAX }, (_, i) => i + 1) as star (star)}
		<button
			type="button"
			class="star"
			class:filled={star <= current}
			aria-label={`Rate ${star} of ${MAX}`}
			aria-pressed={star <= current}
			onclick={(e) => submitRating(e.currentTarget.form!, star === current ? 0 : star)}
		>
			★
		</button>
	{/each}
</form>

<style>
	.rating {
		display: inline-flex;
		gap: 2px;
		align-items: center;
	}

	.star {
		background: none;
		border: none;
		padding: 4px 2px;
		font-size: 1.1rem;
		line-height: 1;
		color: var(--border);
		min-height: 44px;
	}

	.rating.compact .star {
		min-height: 32px;
		font-size: 1rem;
	}

	.star.filled {
		color: var(--star);
	}
</style>
