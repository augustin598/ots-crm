<!--
	Login-ul adminului pe poarta de brand (GateShell), ca login-ul din portal și `/`.
	Trei metode: parolă, magic link și cerere de resetare a parolei.
-->
<script lang="ts">
	import '../layout.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ActionData } from './$types';
	import { Input } from '$lib/components/ui/input';
	import GateShell from '$lib/components/brand/GateShell.svelte';
	import { requestMagicLink, login, requestPasswordReset } from '$lib/remotes/auth.remote';
	import MailIcon from '@lucide/svelte/icons/mail';
	import LockIcon from '@lucide/svelte/icons/lock';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	let { form }: { form: ActionData } = $props();

	// Check for error in URL query params (from verification redirect)
	const urlError = $derived(page.url.searchParams.get('error'));
	const resetParam = $derived(page.url.searchParams.get('reset'));

	const isResetSuccess = $derived(resetParam === 'success');

	type LoginMethod = 'password' | 'magic-link' | 'reset-password';

	const METHODS: { id: LoginMethod; label: string; icon: typeof KeyRoundIcon }[] = [
		{ id: 'password', label: 'Password', icon: KeyRoundIcon },
		{ id: 'magic-link', label: 'Magic Link', icon: WandSparklesIcon },
		{ id: 'reset-password', label: 'Reset', icon: RotateCcwIcon }
	];

	const COPY: Record<LoginMethod, { title: string; subtitle: string }> = {
		password: { title: 'Welcome back', subtitle: 'Sign in to access the admin panel' },
		'magic-link': { title: 'Magic link', subtitle: "We'll email you a secure one-time login link" },
		'reset-password': { title: 'Reset password', subtitle: "We'll email you a link to set a new password" }
	};

	let loginMethod = $derived<LoginMethod>(resetParam === '1' ? 'reset-password' : 'password');
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error = $derived<string | null>(urlError ? decodeURIComponent(urlError) : null);
	let success = $state<string | null>(null);

	function selectMethod(method: LoginMethod) {
		loginMethod = method;
		error = null;
		success = null;
	}

	async function handlePasswordLogin(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
		success = null;

		try {
			const result = await login({ email, password });
			if (result.success) {
				goto('/');
			} else {
				error = result.error || 'Login failed';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
		}
	}

	async function handleMagicLinkRequest(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
		success = null;

		try {
			const result = await requestMagicLink({ email });
			if (result.success) {
				success = result.message;
				email = '';
			} else {
				error = result.error || result.message || 'Failed to send magic link';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
		}
	}

	async function handlePasswordResetRequest(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
		success = null;

		try {
			const result = await requestPasswordReset({ email });
			if (result.success) {
				success = result.message;
				email = '';
			} else {
				error = result.error || result.message || 'Failed to send reset link';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Admin Login - OTS CRM</title>
</svelte:head>

{#snippet alertError(message: string)}
	<div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
		<p class="text-sm text-red-700 dark:text-red-300">{message}</p>
	</div>
{/snippet}

{#snippet alertSuccess(title: string, message: string)}
	<div class="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
		<div class="flex items-start gap-3">
			<CheckCircleIcon class="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
			<div>
				<p class="font-medium text-green-800 dark:text-green-200">{title}</p>
				<p class="mt-1 text-sm text-green-700 dark:text-green-300">{message}</p>
			</div>
		</div>
	</div>
{/snippet}

{#snippet emailField(id: string)}
	<div class="relative">
		<MailIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input
			{id}
			type="email"
			bind:value={email}
			required
			autocomplete="email"
			placeholder="name@company.com"
			aria-label="Email"
			disabled={loading}
			class="h-11 pl-10"
		/>
	</div>
{/snippet}

<GateShell>
	<div class="ots-gate-card">
		<div class="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
			<ShieldCheckIcon class="h-5 w-5 text-primary" />
		</div>

		<h1 class="text-2xl font-bold tracking-tight">{COPY[loginMethod].title}</h1>
		<p class="mt-2 text-sm text-muted-foreground">{COPY[loginMethod].subtitle}</p>

		{#if isResetSuccess}
			<div class="mt-5">
				{@render alertSuccess('Password updated', 'Parola a fost resetată cu succes. Te poți autentifica.')}
			</div>
		{/if}

		<div
			class="mt-6 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-700 dark:bg-slate-800/60"
			role="tablist"
			aria-label="Login method"
		>
			{#each METHODS as method (method.id)}
				{@const Icon = method.icon}
				<button
					type="button"
					role="tab"
					aria-selected={loginMethod === method.id}
					onclick={() => selectMethod(method.id)}
					class="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all sm:text-[13px] {loginMethod ===
					method.id
						? 'bg-white text-[#1877f2] shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<Icon class="size-3.5" />
					{method.label}
				</button>
			{/each}
		</div>

		{#if loginMethod === 'password'}
			<form onsubmit={handlePasswordLogin} class="mt-5 grid gap-3">
				{@render emailField('email')}
				<div class="relative">
					<LockIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="password"
						type="password"
						bind:value={password}
						required
						autocomplete="current-password"
						placeholder="Password"
						aria-label="Password"
						disabled={loading}
						class="h-11 pl-10"
					/>
				</div>
				<div class="flex justify-end">
					<button
						type="button"
						class="text-xs font-medium text-primary hover:underline"
						onclick={() => selectMethod('reset-password')}
					>
						Forgot password?
					</button>
				</div>
				{#if error}
					{@render alertError(error)}
				{/if}
				{#if form?.message}
					{@render alertError(form.message)}
				{/if}
				<button type="submit" class="ots-gate-btn ots-gloss mt-1" disabled={loading}>
					{loading ? 'Logging in...' : 'Login'}
					<ArrowRightIcon class="h-4 w-4" />
				</button>
			</form>
		{:else if loginMethod === 'magic-link'}
			<form onsubmit={handleMagicLinkRequest} class="mt-5 grid gap-3">
				{#if success}
					{@render alertSuccess('Check your email', success)}
				{/if}
				{@render emailField('magic-email')}
				{#if error}
					{@render alertError(error)}
				{/if}
				<button type="submit" class="ots-gate-btn ots-gloss mt-1" disabled={loading}>
					{loading ? 'Sending...' : 'Send Magic Link'}
					<ArrowRightIcon class="h-4 w-4" />
				</button>
			</form>
		{:else}
			<form onsubmit={handlePasswordResetRequest} class="mt-5 grid gap-3">
				{#if success}
					{@render alertSuccess('Check your email', success)}
				{/if}
				{@render emailField('reset-email')}
				{#if error}
					{@render alertError(error)}
				{/if}
				<button type="submit" class="ots-gate-btn ots-gloss mt-1" disabled={loading}>
					{loading ? 'Sending...' : 'Send Reset Link'}
					<ArrowRightIcon class="h-4 w-4" />
				</button>
				<p class="text-center text-xs">
					<button
						type="button"
						class="font-medium text-primary hover:underline"
						onclick={() => selectMethod('password')}
					>
						Back to login
					</button>
				</p>
			</form>
		{/if}
	</div>
</GateShell>
