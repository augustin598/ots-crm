<script lang="ts">
	import '../../../layout.css';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { Input } from '$lib/components/ui/input';
	import GateShell from '$lib/components/brand/GateShell.svelte';
	import { resetPasswordWithToken } from '$lib/remotes/auth.remote';
	import LockIcon from '@lucide/svelte/icons/lock';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';

	let { data }: { data: PageData } = $props();

	let newPassword = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = null;

		if (newPassword !== confirmPassword) {
			error = 'Passwords do not match';
			return;
		}

		if (newPassword.length < 6) {
			error = 'Password must be at least 6 characters';
			return;
		}

		loading = true;

		try {
			await resetPasswordWithToken({
				token: data.token,
				newPassword
			});
			success = true;
			setTimeout(() => {
				goto('/login?reset=success');
			}, 2000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to reset password';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Reset Password - OTS CRM</title>
</svelte:head>

<GateShell>
	<div class="ots-gate-card">
		<div class="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
			<KeyRoundIcon class="h-5 w-5 text-primary" />
		</div>

		<h1 class="text-2xl font-bold tracking-tight">Reset password</h1>
		<p class="mt-2 text-sm text-muted-foreground">Enter your new password below</p>

		{#if success}
			<div
				class="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950"
			>
				<div class="flex items-start gap-3">
					<CheckCircleIcon class="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
					<div>
						<p class="font-medium text-green-800 dark:text-green-200">Password reset successfully</p>
						<p class="mt-1 text-sm text-green-700 dark:text-green-300">Redirecting to login...</p>
					</div>
				</div>
			</div>
			<button class="ots-gate-btn ots-gloss mt-4" onclick={() => goto('/login?reset=success')}>
				Go to Login
				<ArrowRightIcon class="h-4 w-4" />
			</button>
		{:else}
			<form onsubmit={handleSubmit} class="mt-6 grid gap-3">
				<div class="relative">
					<LockIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="newPassword"
						type="password"
						bind:value={newPassword}
						required
						minlength={6}
						autocomplete="new-password"
						placeholder="New password (min. 6 characters)"
						aria-label="New password"
						disabled={loading}
						class="h-11 pl-10"
					/>
				</div>
				<div class="relative">
					<LockIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="confirmPassword"
						type="password"
						bind:value={confirmPassword}
						required
						minlength={6}
						autocomplete="new-password"
						placeholder="Confirm new password"
						aria-label="Confirm password"
						disabled={loading}
						class="h-11 pl-10"
					/>
				</div>
				{#if error}
					<div class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
						<p class="text-sm text-red-700 dark:text-red-300">{error}</p>
					</div>
				{/if}
				<button type="submit" class="ots-gate-btn ots-gloss mt-1" disabled={loading}>
					{loading ? 'Resetting...' : 'Reset Password'}
					<ArrowRightIcon class="h-4 w-4" />
				</button>
				<p class="text-center text-xs">
					<a href="/login" class="font-medium text-primary hover:underline">Back to login</a>
				</p>
			</form>
		{/if}
	</div>
</GateShell>
