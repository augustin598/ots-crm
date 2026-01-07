<script lang="ts">
	import { getServices } from '$lib/remotes/services.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const servicesQuery = getServices({ clientId });
	const services = $derived(servicesQuery.current || []);
	const loading = $derived(servicesQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Services</h2>
		<Button onclick={() => goto(`/${tenantSlug}/services/new?clientId=${clientId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			New Service
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if services.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No services for this client yet</p>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Price</TableHead>
						<TableHead>Recurring</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each services as service}
						<TableRow>
							<TableCell class="font-medium">{service.name}</TableCell>
							<TableCell>{service.price ? `€${(service.price / 100).toFixed(2)}` : '-'}</TableCell>
							<TableCell>{service.recurringType !== 'none' ? `${service.recurringType}` : 'One-time'}</TableCell>
							<TableCell>{service.isActive ? 'Active' : 'Inactive'}</TableCell>
							<TableCell>
								<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/services/${service.id}`)}>
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
