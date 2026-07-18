<script lang="ts">
	type Props = {
		label: string;
		value: string | number;
		sub?: string | null;
		icon?: string | null;
	};

	let { label, value, sub = null, icon = null }: Props = $props();
</script>

<div class="stat-tile">
	{#if icon}<span class="icon" aria-hidden="true">{icon}</span>{/if}
	<span class="value">{value}</span>
	<span class="label muted">{label}</span>
	{#if sub}<span class="sub muted">{sub}</span>{/if}
</div>

<style>
	.stat-tile {
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.icon {
		font-size: 1.25rem;
	}

	.value {
		font-size: 1.6rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	.label {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.sub {
		font-size: 0.72rem;
	}
</style>
