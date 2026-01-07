<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { page } from '$app/state';

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const loading = $derived(clientsQuery.loading);
	const error = $derived(clientsQuery.error);

	const tenantSlug = $derived(page.params.tenant);
</script>

<svelte:head>
	<title>Clients - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Clients</h1>
		<Button onclick={() => goto(`/${tenantSlug}/clients/new`)}>Add Client</Button>
	</div>

	{#if loading}
		<p>Loading clients...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load clients'}</p>
		</div>
	{:else if clients.length === 0}
		<Card>
			<CardHeader>
				<CardTitle>No Clients</CardTitle>
				<CardDescription>Get started by adding your first client</CardDescription>
			</CardHeader>
			<CardContent>
				<Button onclick={() => goto(`/${tenantSlug}/clients/new`)}>Add Client</Button>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Email</TableHead>
						<TableHead>Phone</TableHead>
						<TableHead>CUI</TableHead>
						<TableHead>City</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each clients as client}
						<TableRow>
							<TableCell class="font-medium">{client.name}</TableCell>
							<TableCell>{client.email || '-'}</TableCell>
							<TableCell>{client.phone || '-'}</TableCell>
							<TableCell>{client.cui || '-'}</TableCell>
							<TableCell>{client.city || '-'}</TableCell>
							<TableCell>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => goto(`/${tenantSlug}/clients/${client.id}`)}
								>
									View
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>
