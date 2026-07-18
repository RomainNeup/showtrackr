<script lang="ts">
	import { page } from '$app/state';

	type Tab = { href: string; label: string; icon: string };

	// Mobile bottom navigation (PLAN §6). Emoji icons keep the bundle self-contained.
	const tabs: Tab[] = [
		{ href: '/', label: 'Up Next', icon: '▶' },
		{ href: '/library', label: 'Library', icon: '▤' },
		{ href: '/search', label: 'Search', icon: '⌕' },
		{ href: '/stats', label: 'Stats', icon: '📊' },
		{ href: '/profile', label: 'Profile', icon: '☺' }
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}
</script>

<nav class="tabbar" aria-label="Primary">
	{#each tabs as tab (tab.href)}
		<a
			class="tab"
			class:active={isActive(tab.href)}
			href={tab.href}
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			<span class="icon" aria-hidden="true">{tab.icon}</span>
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
		font-size: 1.25rem;
		line-height: 1;
	}
</style>
