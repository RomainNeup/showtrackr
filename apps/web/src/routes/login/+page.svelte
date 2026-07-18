<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Preserve any post-login destination when linking across to /register.
	const registerHref = $derived.by(() => {
		const rt = page.url.searchParams.get('redirectTo');
		return rt ? `/register?redirectTo=${encodeURIComponent(rt)}` : '/register';
	});
</script>

<div class="login page">
	<div class="brand">
		<div class="logo" aria-hidden="true">📺</div>
		<h1>ShowTrackr</h1>
		<p class="muted">Sign in to continue.</p>
	</div>

	<form method="POST" action="?/login" use:enhance>
		<label>
			<span>Email</span>
			<input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
		</label>

		<label>
			<span>Password</span>
			<input name="password" type="password" autocomplete="current-password" required />
		</label>

		{#if form?.error}
			<p class="error-text">{form.error}</p>
		{/if}

		<button class="btn btn-accent btn-block" type="submit">Sign in</button>
	</form>

	{#if data.canRegister}
		<p class="muted alt">
			Don't have an account? <a href={registerHref}>Create one</a>
		</p>
	{/if}
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

	.alt {
		text-align: center;
		font-size: 0.9rem;
	}

	.alt a {
		color: var(--accent);
		font-weight: 600;
	}
</style>
