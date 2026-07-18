<script lang="ts">
	type Props = {
		value?: string;
		placeholder?: string;
		delay?: number;
		/** Called with the query after debounce settles. */
		onSearch: (query: string) => void;
	};

	let { value = '', placeholder = 'Search shows & movies…', delay = 350, onSearch }: Props =
		$props();

	let query = $state(value);
	let timer: ReturnType<typeof setTimeout> | undefined;

	// The last query we emitted via onSearch (which drives the ?q= URL).
	// Used to tell apart two kinds of `value` prop changes:
	//   1. The URL echoing our own in-progress search back to us — IGNORE it,
	//      otherwise the round-trip overwrites what the user is still typing
	//      and characters vanish/revert.
	//   2. Genuine external navigation (back/forward, a shared link) that this
	//      box did not originate — RESYNC the field to match the URL.
	let lastEmitted = value;

	// Resync only on external `value` changes. This effect depends solely on
	// `value` (not `query`), so typing never re-triggers it. `lastEmitted` is a
	// plain (non-reactive) var on purpose: reading it here must not make the
	// effect re-run when we update it.
	$effect(() => {
		if (value !== lastEmitted) {
			query = value;
			lastEmitted = value;
		}
	});

	function emit(next: string) {
		// Record what we're pushing out BEFORE navigation, so the URL echo that
		// comes back through `value` is recognised as our own and ignored.
		lastEmitted = next;
		onSearch(next);
	}

	function handleInput() {
		// `query` is kept current by bind:value; just (re)arm the debounce.
		clearTimeout(timer);
		timer = setTimeout(() => emit(query.trim()), delay);
	}

	function clear() {
		query = '';
		clearTimeout(timer);
		emit('');
	}
</script>

<div class="search-bar">
	<span class="icon" aria-hidden="true">⌕</span>
	<input
		type="search"
		inputmode="search"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		{placeholder}
		aria-label="Search shows and movies"
		bind:value={query}
		oninput={handleInput}
	/>
	{#if query}
		<button type="button" class="clear" onclick={clear} aria-label="Clear search">✕</button>
	{/if}
</div>

<style>
	.search-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 14px;
		height: 46px;
	}

	.icon {
		color: var(--text-muted);
		font-size: 1.2rem;
	}

	input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text);
		outline: none;
		height: 100%;
	}

	/* Suppress the browser's native ✕ so only our custom .clear button shows. */
	input[type='search']::-webkit-search-cancel-button,
	input[type='search']::-webkit-search-decoration {
		-webkit-appearance: none;
		appearance: none;
	}

	.clear {
		border: none;
		background: var(--bg-elev-2);
		color: var(--text-muted);
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
