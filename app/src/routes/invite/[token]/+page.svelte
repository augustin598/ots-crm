<script lang="ts">
	import type { PageData } from './$types';
	import { acceptInvitation } from '$lib/remotes/invitations.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	let { data }: { data: PageData } = $props();

	const token = $derived(page.params.token || '');
	let accepting = $state(false);
	let error = $state<string | null>(null);

	async function handleAccept() {
		accepting = true;
		error = null;

		try {
			const result = await acceptInvitation(token);
			if (result.success && result.tenantSlug) {
				goto(`/${result.tenantSlug}`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to accept invitation';
		} finally {
			accepting = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-md">
		<CardHeader>
			<CardTitle class="text-2xl font-bold">Invitation</CardTitle>
			<CardDescription>You've been invited to join an organization</CardDescription>
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
				<div class="space-y-4">
					<div class="space-y-2">
						<p class="text-sm text-muted-foreground">
							<strong>
								{data.invitation.invitedBy
									? `${data.invitation.invitedBy.firstName} ${data.invitation.invitedBy.lastName}`.trim() ||
									  data.invitation.invitedBy.email
									: 'Someone'}
							</strong>{' '}
							has invited you to join
						</p>
						<p class="text-lg font-semibold">{data.invitation.tenant?.name}</p>
						<p class="text-sm text-muted-foreground">
							Role: <span class="capitalize">{data.invitation.role}</span>
						</p>
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="space-y-2">
						{#if data.isLoggedIn}
							<Button onclick={handleAccept} disabled={accepting} class="w-full">
								{accepting ? 'Accepting...' : 'Accept Invitation'}
							</Button>
						{:else}
							<Button variant="outline" onclick={() => goto('/invite/' + token + '/signup')} class="w-full">
								Sign Up to Accept
							</Button>
							<Button
								variant="ghost"
								onclick={() => goto('/login?redirect=' + encodeURIComponent('/invite/' + token))}
								class="w-full"
							>
								Login to Accept
							</Button>
						{/if}
					</div>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">Loading invitation...</p>
			{/if}
		</CardContent>
	</Card>
</div>
