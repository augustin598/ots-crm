<script lang="ts">
	import { requestMagicLink } from '$lib/remotes/client-auth.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	const tenantSlug = $derived(page.params.tenant as string);
	const urlError = $derived(page.url.searchParams.get('error'));

	let email = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	// Set error from URL if present
	$effect(() => {
		if (urlError) {
			error = decodeURIComponent(urlError);
		}
	});

	async function handleSubmit() {
		if (!email.trim()) {
			error = 'Please enter your email';
			return;
		}

		loading = true;
		error = null;
		success = false;

		try {
			await requestMagicLink({
				tenantSlug,
				email: email.trim()
			});
			success = true;
			email = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Request failed. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Client Login - CRM</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Client Login</CardTitle>
			<CardDescription>Enter your email to receive a magic link</CardDescription>
		</CardHeader>
		<CardContent>
			{#if success}
				<div class="rounded-md bg-green-50 p-4">
					<p class="text-sm text-green-800">
						If a client account exists, a magic link has been sent to your email. Please check your inbox.
					</p>
				</div>
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							bind:value={email}
							type="email"
							required
							autocomplete="email"
							placeholder="Enter your email"
							disabled={loading}
						/>
					</div>
					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}
					<Button type="submit" class="w-full" disabled={loading}>
						{loading ? 'Sending...' : 'Send Magic Link'}
					</Button>
				</form>
			{/if}
			<div class="mt-4 text-center text-sm text-gray-600">
				<p>
					New client?
					<a href="/client/{tenantSlug}/signup" class="text-blue-600 hover:underline">
						Sign up here
					</a>
				</p>
			</div>
		</CardContent>
	</Card>
</div>
