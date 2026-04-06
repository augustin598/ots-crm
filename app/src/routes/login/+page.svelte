<script lang="ts">
	import '../layout.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ActionData } from './$types';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { requestMagicLink, login, requestPasswordReset } from '$lib/remotes/auth.remote';

	let { form }: { form: ActionData } = $props();

	// Check for error in URL query params (from verification redirect)
	const urlError = $derived(page.url.searchParams.get('error'));
	const resetParam = $derived(page.url.searchParams.get('reset'));

	const isResetSuccess = $derived(resetParam === 'success');

	let loginMethod = $state<'password' | 'magic-link' | 'reset-password'>('password');
	$effect(() => {
		loginMethod = resetParam === '1' ? 'reset-password' : 'password';
	});
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	$effect(() => {
		error = urlError ? decodeURIComponent(urlError) : null;
	});
	let success = $state<string | null>(null);

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

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Admin Login</CardTitle>
			<CardDescription>Choose your login method to access the admin panel</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="space-y-4">
				{#if isResetSuccess}
					<div class="rounded-md bg-green-50 border border-green-200 p-3">
						<p class="text-sm font-medium text-green-800">Parola a fost resetată cu succes. Te poți autentifica.</p>
					</div>
				{/if}

				<div class="space-y-2">
					<Label>Login Method</Label>
					<div class="grid grid-cols-3 gap-2 rounded-lg border p-1 bg-muted">
						<button
							type="button"
							onclick={() => {
								loginMethod = 'password';
								error = null;
								success = null;
							}}
							class="rounded-md px-2 py-2 text-xs font-medium transition-colors sm:px-3 sm:text-sm {loginMethod === 'password'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							Password
						</button>
						<button
							type="button"
							onclick={() => {
								loginMethod = 'magic-link';
								error = null;
								success = null;
							}}
							class="rounded-md px-2 py-2 text-xs font-medium transition-colors sm:px-3 sm:text-sm {loginMethod === 'magic-link'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							Magic Link
						</button>
						<button
							type="button"
							onclick={() => {
								loginMethod = 'reset-password';
								error = null;
								success = null;
							}}
							class="rounded-md px-2 py-2 text-xs font-medium transition-colors sm:px-3 sm:text-sm {loginMethod === 'reset-password'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							Reset
						</button>
					</div>
				</div>

				{#if loginMethod === 'password'}
					<form onsubmit={handlePasswordLogin} class="space-y-4">
						<div class="space-y-2">
							<Label for="email">Email</Label>
							<Input
								id="email"
								type="email"
								bind:value={email}
								required
								autocomplete="email"
								placeholder="Enter your email"
								disabled={loading}
							/>
						</div>
						<div class="space-y-2">
							<Label for="password">Password</Label>
							<Input
								id="password"
								type="password"
								bind:value={password}
								required
								autocomplete="current-password"
								placeholder="Enter your password"
								disabled={loading}
							/>
						</div>
						{#if error}
							<div class="rounded-md bg-red-50 p-3">
								<p class="text-sm text-red-800">{error}</p>
							</div>
						{/if}
						{#if form?.message}
							<div class="rounded-md bg-red-50 p-3">
								<p class="text-sm text-red-800">{form.message}</p>
							</div>
						{/if}
						<Button type="submit" class="w-full" disabled={loading}>
							{loading ? 'Logging in...' : 'Login'}
						</Button>
						<p class="text-center">
							<button
								type="button"
								class="text-sm text-primary hover:underline"
								onclick={() => {
									loginMethod = 'reset-password';
									error = null;
									success = null;
								}}
							>
								Forgot password?
							</button>
						</p>
					</form>
				{:else if loginMethod === 'magic-link'}
					<form onsubmit={handleMagicLinkRequest} class="space-y-4">
						<div class="space-y-2">
							<Label for="magic-email">Email</Label>
							<Input
								id="magic-email"
								type="email"
								bind:value={email}
								required
								autocomplete="email"
								placeholder="Enter your email"
								disabled={loading}
							/>
						</div>
						{#if success}
							<div class="rounded-md bg-green-50 p-3">
								<p class="text-sm text-green-800">{success}</p>
							</div>
						{/if}
						{#if error}
							<div class="rounded-md bg-red-50 p-3">
								<p class="text-sm text-red-800">{error}</p>
							</div>
						{/if}
						<Button type="submit" class="w-full" disabled={loading}>
							{loading ? 'Sending...' : 'Send Magic Link'}
						</Button>
						<p class="text-sm text-gray-600 text-center">
							We'll send you a secure link to log in. Check your email inbox.
						</p>
					</form>
				{:else}
					<form onsubmit={handlePasswordResetRequest} class="space-y-4">
						<div class="space-y-2">
							<Label for="reset-email">Email</Label>
							<Input
								id="reset-email"
								type="email"
								bind:value={email}
								required
								autocomplete="email"
								placeholder="Enter your email"
								disabled={loading}
							/>
						</div>
						{#if success}
							<div class="rounded-md bg-green-50 p-3">
								<p class="text-sm text-green-800">{success}</p>
							</div>
						{/if}
						{#if error}
							<div class="rounded-md bg-red-50 p-3">
								<p class="text-sm text-red-800">{error}</p>
							</div>
						{/if}
						<Button type="submit" class="w-full" disabled={loading}>
							{loading ? 'Sending...' : 'Send Reset Link'}
						</Button>
						<p class="text-sm text-gray-600 text-center">
							We'll send you a secure link to reset your password. Check your email inbox.
						</p>
					</form>
				{/if}
			</div>
		</CardContent>
	</Card>
</div>

