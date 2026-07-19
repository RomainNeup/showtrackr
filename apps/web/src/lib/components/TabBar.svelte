<script lang="ts">
	import { page } from '$app/state';

	type IconName = 'up-next' | 'library' | 'search' | 'stats' | 'profile';
	type Tab = { href: string; label: string; icon: IconName };

	// Mobile bottom navigation (PLAN §6). Inline SVG icons keep the bundle
	// self-contained (offline PWA) and render identically on every platform,
	// honouring the active/inactive color via `stroke="currentColor"`.
	const tabs: Tab[] = [
		{ href: '/', label: 'Up Next', icon: 'up-next' },
		{ href: '/library', label: 'Library', icon: 'library' },
		{ href: '/search', label: 'Search', icon: 'search' },
		{ href: '/stats', label: 'Stats', icon: 'stats' },
		{ href: '/profile', label: 'Profile', icon: 'profile' }
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}
</script>

{#snippet icon(name: IconName)}
	<svg
		class="icon"
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
		{#if name === 'up-next'}
			<!-- play / next -->
			<polygon points="6 4 18 12 6 20 6 4" />
		{:else if name === 'library'}
			<!-- stacked list -->
			<line x1="8" y1="6" x2="21" y2="6" />
			<line x1="8" y1="12" x2="21" y2="12" />
			<line x1="8" y1="18" x2="21" y2="18" />
			<line x1="3" y1="6" x2="3.01" y2="6" />
			<line x1="3" y1="12" x2="3.01" y2="12" />
			<line x1="3" y1="18" x2="3.01" y2="18" />
		{:else if name === 'search'}
			<!-- magnifier -->
			<circle cx="11" cy="11" r="7" />
			<line x1="21" y1="21" x2="16.65" y2="16.65" />
		{:else if name === 'stats'}
			<!-- bar chart -->
			<line x1="6" y1="20" x2="6" y2="12" />
			<line x1="12" y1="20" x2="12" y2="4" />
			<line x1="18" y1="20" x2="18" y2="9" />
		{:else if name === 'profile'}
			<!-- person / user -->
			<circle cx="12" cy="8" r="4" />
			<path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
		{/if}
	</svg>
{/snippet}

<nav class="tabbar" aria-label="Primary">
	{#each tabs as tab (tab.href)}
		<a
			class="tab"
			class:active={isActive(tab.href)}
			href={tab.href}
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			{@render icon(tab.icon)}
			<span class="label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.tabbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: calc(var(--tabbar-h) + var(--safe-bottom));
		padding-bottom: var(--safe-bottom);
		display: flex;
		background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
		backdrop-filter: saturate(180%) blur(12px);
		border-top: 1px solid var(--border);
		z-index: 50;
	}

	.tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: 44px;
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 600;
	}

	.tab.active {
		color: var(--accent);
	}

	.icon {
		width: 22px;
		height: 22px;
		display: block;
	}
</style>
