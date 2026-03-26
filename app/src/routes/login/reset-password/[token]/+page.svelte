<script lang="ts">
	import '../../../layout.css';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { resetPasswordWithToken } from '$lib/remotes/auth.remote';

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
	<title>Reset Password - DAVFOR GROUP</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Reset Password</CardTitle>
			<CardDescription>Enter your new password below</CardDescription>
		</CardHeader>
		<CardContent>
			{#if success}
				<div class="space-y-4">
					<div class="rounded-md bg-green-50 p-3">
						<p class="text-sm text-green-800">Password reset successfully! Redirecting to login...</p>
					</div>
					<Button class="w-full" onclick={() => goto('/login?reset=success')}>Go to Login</Button>
				</div>
			{:else}
				<form onsubmit={handleSubmit} class="space-y-4">
					<div class="space-y-2">
						<Label for="newPassword">New Password</Label>
						<Input
							id="newPassword"
							type="password"
							bind:value={newPassword}
							required
							minlength={6}
							autocomplete="new-password"
							placeholder="Enter new password (min. 6 characters)"
							disabled={loading}
						/>
					</div>
					<div class="space-y-2">
						<Label for="confirmPassword">Confirm Password</Label>
						<Input
							id="confirmPassword"
							type="password"
							bind:value={confirmPassword}
							required
							minlength={6}
							autocomplete="new-password"
							placeholder="Confirm new password"
							disabled={loading}
						/>
					</div>
					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}
					<Button type="submit" class="w-full" disabled={loading}>
						{loading ? 'Resetting...' : 'Reset Password'}
					</Button>
					<p class="text-center">
						<a href="/login" class="text-sm text-primary hover:underline">Back to Login</a>
					</p>
				</form>
			{/if}
		</CardContent>
	</Card>
</div>
