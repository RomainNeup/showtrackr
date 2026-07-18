<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import TabBar from '$lib/components/TabBar.svelte';
	import type { Snippet } from 'svelte';

	let { children, data }: { children: Snippet; data: { user: unknown } } = $props();

	// The bottom tab bar is hidden on the login screen (no chrome pre-auth).
	const showTabBar = $derived(!!data.user && page.url.pathname !== '/login');
</script>

<div class="app-shell">
	{@render children()}
</div>

{#if showTabBar}
	<TabBar />
{/if}
