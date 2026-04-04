<script lang="ts">
	import type { PageData } from './$types';
	import { registerWithTenant } from '$lib/remotes/register.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data }: { data: PageData } = $props();

	const token = $derived(page.params.token || '');

	let email = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Pre-fill email from invitation
	$effect(() => {
		if (data.invitation?.email && !email) {
			email = data.invitation.email;
		}
	});

	async function handleSubmit() {
		if (!token) {
			error = 'Invalid invitation token';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await registerWithTenant({
				email,
				firstName,
				lastName,
				password,
				passwordConfirm,
				invitationToken: token
			});

			if (result.success && result.tenantSlug) {
				goto(`/${result.tenantSlug}`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create account';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Create Account</CardTitle>
			<CardDescription>
				{#if data.invitation}
					Join {data.invitation.tenant?.name}
				{:else}
					Sign up to accept invitation
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if data.error}
				<div class="space-y-4">
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{data.error}</p>
					</div>
					<Button onclick={() => goto('/')} class="w-full">
						Go to Home
					</Button>
				</div>
			{:else if data.invitation}
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
							type="email"
							bind:value={email}
							required
							disabled
							class="bg-gray-50"
						/>
						<p class="text-xs text-muted-foreground">This email was used for your invitation</p>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="firstName">First Name</Label>
							<Input
								id="firstName"
								bind:value={firstName}
								type="text"
								required
								autocomplete="given-name"
								placeholder="Enter your first name"
							/>
						</div>
						<div class="space-y-2">
							<Label for="lastName">Last Name</Label>
							<Input
								id="lastName"
								bind:value={lastName}
								type="text"
								required
								autocomplete="family-name"
								placeholder="Enter your last name"
							/>
						</div>
					</div>

					<div class="space-y-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							bind:value={password}
							type="password"
							required
							autocomplete="new-password"
							placeholder="Enter your password"
						/>
					</div>

					<div class="space-y-2">
						<Label for="passwordConfirm">Confirm Password</Label>
						<Input
							id="passwordConfirm"
							bind:value={passwordConfirm}
							type="password"
							required
							autocomplete="new-password"
							placeholder="Confirm your password"
						/>
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<Button type="submit" disabled={loading} class="w-full">
						{loading ? 'Creating Account...' : 'Create Account & Accept Invitation'}
					</Button>
				</form>
			{:else}
				<p class="text-sm text-muted-foreground">Loading invitation...</p>
			{/if}
		</CardContent>
	</Card>
</div>
