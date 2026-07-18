<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const loginHref = $derived.by(() => {
		const rt = page.url.searchParams.get('redirectTo');
		return rt ? `/login?redirectTo=${encodeURIComponent(rt)}` : '/login';
	});

	// Not every fail() branch carries `email` (e.g. the "registration closed" 403).
	const emailValue = $derived(form && 'email' in form ? (form.email ?? '') : '');
</script>

<div class="login page">
	<div class="brand">
		<div class="logo" aria-hidden="true">📺</div>
		<h1>ShowTrackr</h1>
		<p class="muted">
			{data.open ? 'Create your account to get started.' : 'Registration is closed.'}
		</p>
	</div>

	{#if data.open}
		<form method="POST" action="?/register" use:enhance>
			<label>
				<span>Display name</span>
				<input name="displayName" type="text" autocomplete="name" placeholder="Optional" />
			</label>

			<label>
				<span>Email</span>
				<input name="email" type="email" autocomplete="email" required value={emailValue} />
			</label>

			<label>
				<span>Password</span>
				<input
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength={8}
				/>
			</label>

			{#if form?.error}
				<p class="error-text">{form.error}</p>
			{/if}

			<button class="btn btn-accent btn-block" type="submit">Create account</button>
		</form>

		<p class="muted alt">
			Already have an account? <a href={loginHref}>Sign in</a>
		</p>
	{:else}
		<div class="closed card">
			<p>
				New account registration is disabled on this instance. If you already have an account you
				can still sign in.
			</p>
			<a class="btn btn-accent btn-block" href={loginHref}>Go to sign in</a>
		</div>
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

	.closed {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		text-align: center;
	}
</style>
