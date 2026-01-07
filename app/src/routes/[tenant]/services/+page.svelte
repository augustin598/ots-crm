<script lang="ts">
	import { getServices, createService, deleteService } from '$lib/remotes/services.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogTrigger
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

	const tenantSlug = $derived(page.params.tenant);
	const servicesQuery = getServices({});
	const services = $derived(servicesQuery.current || []);
	const loading = $derived(servicesQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	// Create a map of client IDs to names
	const clientMap = $derived(
		new Map(clients.map((client) => [client.id, client.name]))
	);

	let isDialogOpen = $state(false);
	let formName = $state('');
	let formDescription = $state('');
	let formClientId = $state('');
	let formCategory = $state('');
	let formPrice = $state('');
	let formUnit = $state('hour');
	let formActive = $state(true);
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	// Map recurring type to display unit
	function getUnitFromRecurringType(recurringType: string): string {
		switch (recurringType) {
			case 'daily':
				return 'day';
			case 'weekly':
				return 'week';
			case 'monthly':
				return 'month';
			case 'yearly':
				return 'year';
			case 'none':
			default:
				return 'project';
		}
	}

	// Map unit to recurring type for saving
	function getRecurringTypeFromUnit(unit: string): string {
		switch (unit) {
			case 'hour':
				return 'none'; // One-time per hour
			case 'day':
				return 'daily';
			case 'project':
				return 'none';
			case 'month':
				return 'monthly';
			default:
				return 'none';
		}
	}

	function getCategoryColor(category: string) {
		switch (category) {
			case 'Development':
				return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
			case 'Design':
				return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
			case 'Marketing':
				return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
			case 'Consulting':
				return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
			default:
				return 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300';
		}
	}

	async function handleCreateService() {
		if (!formName || !formClientId) {
			formError = 'Service name and client are required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await createService({
				name: formName,
				description: formDescription || undefined,
				category: formCategory || undefined,
				clientId: formClientId,
				price: formPrice ? parseFloat(formPrice) : undefined,
				recurringType: getRecurringTypeFromUnit(formUnit),
				recurringInterval: 1,
				isActive: formActive
			});

			// Reset form
			formName = '';
			formDescription = '';
			formClientId = '';
			formCategory = '';
			formPrice = '';
			formUnit = 'hour';
			formActive = true;
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create service';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteService(serviceId: string) {
		if (!confirm('Are you sure you want to delete this service?')) {
			return;
		}

		try {
			await deleteService(serviceId);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete service');
		}
	}

	function formatPrice(price: number | null): string {
		if (!price) return '-';
		return `€${(price / 100).toFixed(2)}`;
	}

	function formatUnit(recurringType: string): string {
		const unit = getUnitFromRecurringType(recurringType);
		if (unit === 'project') return 'Per Project';
		if (unit === 'day') return 'Per Day';
		if (unit === 'month') return 'Per Month';
		if (unit === 'week') return 'Per Week';
		if (unit === 'year') return 'Per Year';
		return 'Per Hour';
	}
</script>

<svelte:head>
	<title>Services - CRM</title>
</svelte:head>

<div class="mb-8 flex items-center justify-between">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Services</h1>
		<p class="text-muted-foreground mt-1">Manage your service catalog and pricing</p>
	</div>
	<Dialog bind:open={isDialogOpen}>
		<DialogTrigger>
			<Button>
				<PlusIcon class="mr-2 h-4 w-4" />
				Add Service
			</Button>
		</DialogTrigger>
		<DialogContent class="sm:max-w-[600px]">
			<DialogHeader>
				<DialogTitle>Add New Service</DialogTitle>
				<DialogDescription>Create a new service offering for your clients</DialogDescription>
			</DialogHeader>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="name">Service Name</Label>
					<Input id="name" bind:value={formName} placeholder="Web Development" />
				</div>
				<div class="grid gap-2">
					<Label for="description">Description</Label>
					<Textarea
						id="description"
						bind:value={formDescription}
						placeholder="Describe what this service includes..."
					/>
				</div>
				<div class="grid gap-2">
					<Label for="clientId">Client *</Label>
					<Select type="single" bind:value={formClientId}>
						<SelectTrigger id="clientId">
							{#if formClientId}
								{clientMap.get(formClientId) || 'Select a client'}
							{:else}
								Select a client
							{/if}
						</SelectTrigger>
						<SelectContent>
							{#each clients as client}
								<SelectItem value={client.id}>{client.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
				<div class="grid gap-2">
					<Label for="category">Category</Label>
					<Select type="single" bind:value={formCategory}>
						<SelectTrigger id="category">
							{#if formCategory}
								{formCategory}
							{:else}
								Select a category
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="Development">Development</SelectItem>
							<SelectItem value="Design">Design</SelectItem>
							<SelectItem value="Marketing">Marketing</SelectItem>
							<SelectItem value="Consulting">Consulting</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="grid gap-2">
						<Label for="price">Price</Label>
						<Input id="price" type="number" bind:value={formPrice} placeholder="150" step="0.01" />
					</div>
					<div class="grid gap-2">
						<Label for="unit">Unit</Label>
						<Select type="single" bind:value={formUnit}>
							<SelectTrigger id="unit">
								{#if formUnit === 'hour'}
									Per Hour
								{:else if formUnit === 'day'}
									Per Day
								{:else if formUnit === 'project'}
									Per Project
								{:else if formUnit === 'month'}
									Per Month
								{:else}
									Select unit
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="hour">Per Hour</SelectItem>
								<SelectItem value="day">Per Day</SelectItem>
								<SelectItem value="project">Per Project</SelectItem>
								<SelectItem value="month">Per Month</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<div class="space-y-0.5">
						<Label for="active">Active Service</Label>
						<p class="text-sm text-muted-foreground">Make this service available for clients</p>
					</div>
					<Switch id="active" bind:checked={formActive} />
				</div>
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-300">{formError}</p>
				</div>
			{/if}
			<DialogFooter>
				<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
				<Button onclick={handleCreateService} disabled={formLoading}>
					{formLoading ? 'Adding...' : 'Add Service'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
</div>

{#if loading}
	<p>Loading services...</p>
{:else if services.length === 0}
	<Card>
		<div class="p-6 text-center">
			<p class="text-muted-foreground">No services yet. Get started by adding your first service.</p>
		</div>
	</Card>
{:else}
	<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
		{#each services as service}
			<Card class="p-6">
				<div class="flex items-start justify-between mb-4">
					<div class="flex-1">
						<div class="flex items-center gap-2 mb-2">
							<h3 class="text-xl font-semibold">{service.name}</h3>
							{#if service.isActive}
								<Badge variant="default">Active</Badge>
							{:else}
								<Badge variant="outline">Inactive</Badge>
							{/if}
							{#if service.category}
								<Badge class={getCategoryColor(service.category)}>{service.category}</Badge>
							{/if}
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger>
							<Button variant="ghost" size="icon">
								<MoreVerticalIcon class="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/services/${service.id}/edit`)}>
								Edit
							</DropdownMenuItem>
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/services/${service.id}`)}>
								View Details
							</DropdownMenuItem>
							<DropdownMenuItem>
								{service.isActive ? 'Deactivate' : 'Activate'}
							</DropdownMenuItem>
							<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteService(service.id)}>
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<p class="text-sm text-muted-foreground mb-4 line-clamp-2">
					{service.description || 'No description provided'}
				</p>

				<div class="pt-4 border-t">
					<div class="flex items-baseline gap-1">
						<span class="text-3xl font-bold text-primary">{formatPrice(service.price)}</span>
						<span class="text-sm text-muted-foreground">/ {formatUnit(service.recurringType)}</span>
					</div>
				</div>
			</Card>
		{/each}
	</div>
{/if}
