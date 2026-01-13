<script lang="ts">
	import { clientSignup } from '$lib/remotes/client-auth.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	const tenantSlug = $derived(page.params.tenant as string);

	let cui = $state('');
	let email = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	async function handleSubmit() {
		if (!cui.trim() || !email.trim()) {
			error = 'Please fill in all fields';
			return;
		}

		loading = true;
		error = null;
		success = false;

		try {
			await clientSignup({
				tenantSlug,
				cui: cui.trim(),
				email: email.trim()
			});
			success = true;
			cui = '';
			email = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Signup failed. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Client Signup - CRM</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Client Signup</CardTitle>
			<CardDescription>Enter your CUI and email to access the client portal</CardDescription>
		</CardHeader>
		<CardContent>
			{#if success}
				<div class="rounded-md bg-green-50 p-4">
					<p class="text-sm text-green-800">
						Magic link sent to your email! Please check your inbox and click the link to log in.
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
						<Label for="cui">CUI (VAT Code)</Label>
						<Input
							id="cui"
							bind:value={cui}
							type="text"
							required
							placeholder="Enter your CUI"
							disabled={loading}
						/>
					</div>
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
						{loading ? 'Sending...' : 'Request Access'}
					</Button>
				</form>
			{/if}
			<div class="mt-4 text-center text-sm text-gray-600">
				<p>
					Already have an account?
					<a href="/client/{tenantSlug}/login" class="text-blue-600 hover:underline">
						Request login link
					</a>
				</p>
			</div>
		</CardContent>
	</Card>
</div>
