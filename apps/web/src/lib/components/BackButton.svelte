<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	// `overlay` floats the button over a hero/backdrop (top-left, notch-safe) with
	// a semi-transparent circular background; otherwise it renders inline (e.g. in
	// a page header where a plain chevron link used to be).
	let { overlay = false }: { overlay?: boolean } = $props();

	function goBack() {
		// Standalone PWA: no browser chrome, so provide our own back affordance.
		// Prefer real history; fall back to the library on a cold start / deep link.
		if (browser && window.history.length > 1) {
			history.back();
		} else {
			goto('/library');
		}
	}
</script>

<button type="button" class="back-btn" class:overlay aria-label="Go back" onclick={goBack}>
	<svg
		viewBox="0 0 24 24"
		width="24"
		height="24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<polyline points="15 18 9 12 15 6" />
	</svg>
</button>

<style>
	.back-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		border-radius: 999px;
	}

	.back-btn.overlay {
		position: absolute;
		/* Respect the notch / status bar on standalone PWA. */
		top: calc(env(safe-area-inset-top, 0px) + 8px);
		left: 12px;
		z-index: 10;
		color: #fff;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(6px);
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
	}
</style>
