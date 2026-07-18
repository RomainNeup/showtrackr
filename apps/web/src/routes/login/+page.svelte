<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const firstRun = $derived(data.firstRun);
</script>

<div class="login page">
	<div class="brand">
		<div class="logo" aria-hidden="true">📺</div>
		<h1>ShowTrackr</h1>
		<p class="muted">
			{firstRun ? 'Create your account to get started.' : 'Sign in to continue.'}
		</p>
	</div>

	<form method="POST" action={firstRun ? '?/register' : '?/login'} use:enhance>
		{#if firstRun}
			<label>
				<span>Display name</span>
				<input name="displayName" type="text" autocomplete="name" placeholder="Optional" />
			</label>
		{/if}

		<label>
			<span>Email</span>
			<input
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
			/>
		</label>

		<label>
			<span>Password</span>
			<input
				name="password"
				type="password"
				autocomplete={firstRun ? 'new-password' : 'current-password'}
				required
				minlength={firstRun ? 8 : undefined}
			/>
		</label>

		{#if form?.error}
			<p class="error-text">{form.error}</p>
		{/if}

		<button class="btn btn-accent btn-block" type="submit">
			{firstRun ? 'Create account' : 'Sign in'}
		</button>
	</form>
</div>

<style>
	.login {
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: 24px;
		justify-content: center;
		min-height: 80dvh;
	}

	.brand {
		text-align: center;
	}

	.logo {
		font-size: 3rem;
	}

	.brand h1 {
		margin: 8px 0 4px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.85rem;
		font-weight: 600;
	}

	input {
		height: 46px;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-elev);
		color: var(--text);
	}
</style>
