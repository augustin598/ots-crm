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

	const tenantSlug = $derived(page.params.tenant);
	const servicesQuery = getServices({});
	const services = $derived(servicesQuery.current || []);
	const loading = $derived(servicesQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Services</h1>
		<Button onclick={() => goto(`/${tenantSlug}/services/new`)}>New Service</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if services.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-gray-500">No services yet</p>
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
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each services as service}
						<TableRow>
							<TableCell class="font-medium">{service.name}</TableCell>
							<TableCell>{service.price ? `€${(service.price / 100).toFixed(2)}` : '-'}</TableCell>
							<TableCell>{service.recurringType !== 'none' ? `${service.recurringType}` : 'One-time'}</TableCell>
							<TableCell>{service.isActive ? 'Active' : 'Inactive'}</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>
