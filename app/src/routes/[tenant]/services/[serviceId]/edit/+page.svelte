<script lang="ts">
	import { getService, updateService, getServices } from '$lib/remotes/services.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Switch } from '$lib/components/ui/switch';

	const tenantSlug = $derived(page.params.tenant);
	const serviceId = $derived(page.params.serviceId);

	const serviceQuery = $derived(serviceId ? getService(serviceId) : null);
	const service = $derived(serviceQuery?.current);
	const loading = $derived(serviceQuery?.loading ?? false);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	let name = $state('');
	let description = $state('');
	let category = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let price = $state('');
	let currency = $state<Currency>('RON');
	let unit = $state('hour');
	let isActive = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);

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
				return 'none';
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

	$effect(() => {
		if (service) {
			name = service.name || '';
			description = service.description || '';
			category = service.category || '';
			clientId = service.clientId || '';
			projectId = service.projectId || '';
			price = service.price ? (service.price / 100).toString() : '';
			currency = (service.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
			unit = getUnitFromRecurringType(service.recurringType);
			isActive = service.isActive !== undefined ? service.isActive : true;
		}
	});

	$effect(() => {
		if (invoiceSettings && !service) {
			currency = (invoiceSettings.defaultCurrency || 'RON') as Currency;
		}
	});

	async function handleSubmit() {
		if (!name || !clientId || !serviceId) {
			error = 'Service name and client are required';
			return;
		}

		saving = true;
		error = null;

		try {
			const updates = [getServices({})];
			if (serviceQuery) updates.push(serviceQuery);

			await updateService({
				serviceId,
				name,
				description: description || undefined,
				category: category || undefined,
				clientId,
				projectId: projectId || undefined,
				price: price ? parseFloat(price) : undefined,
				currency: currency || undefined,
				recurringType: getRecurringTypeFromUnit(unit),
				recurringInterval: 1,
				isActive: isActive
			}).updates(...updates);

			goto(`/${tenantSlug}/services/${serviceId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update service';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Edit Service - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading service...</p>
	{:else if service}
		<h1 class="text-3xl font-bold">Edit Service</h1>

		<Card>
			<CardHeader>
				<CardTitle>Service Information</CardTitle>
				<CardDescription>Update service details</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-4"
				>
					<div class="grid gap-2">
						<Label for="name">Service Name *</Label>
						<Input id="name" bind:value={name} placeholder="Web Development" required />
					</div>
					<div class="grid gap-2">
						<Label for="description">Description</Label>
						<Textarea
							id="description"
							bind:value={description}
							placeholder="Describe what this service includes..."
						/>
					</div>
					<div class="grid gap-2">
						<Label for="clientId">Client *</Label>
						<Combobox
							bind:value={clientId}
							options={clientOptions}
							placeholder="Select a client"
							searchPlaceholder="Search clients..."
						/>
					</div>
					<div class="grid gap-2">
						<Label for="category">Category</Label>
						<Select type="single" bind:value={category}>
							<SelectTrigger id="category">
								{#if category}
									{category}
								{:else}
									Select a category
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">None</SelectItem>
								<SelectItem value="Development">Development</SelectItem>
								<SelectItem value="Design">Design</SelectItem>
								<SelectItem value="Marketing">Marketing</SelectItem>
								<SelectItem value="Consulting">Consulting</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div class="grid gap-2">
						<Label for="price">Price</Label>
						<Input id="price" type="number" bind:value={price} placeholder="150" step="0.01" />
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-2">
							<Label for="currency">Currency</Label>
							<Select type="single" bind:value={currency}>
								<SelectTrigger id="currency">
									{CURRENCY_LABELS[currency]}
								</SelectTrigger>
								<SelectContent>
									{#each CURRENCIES as curr}
										<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="grid gap-2">
							<Label for="unit">Unit</Label>
							<Select type="single" bind:value={unit}>
								<SelectTrigger id="unit">
									{#if unit === 'hour'}
										Per Hour
									{:else if unit === 'day'}
										Per Day
									{:else if unit === 'project'}
										Per Project
									{:else if unit === 'month'}
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
						<Switch id="active" bind:checked={isActive} />
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
							<p class="text-sm text-red-800 dark:text-red-300">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/services/${serviceId}`)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{:else}
		<p>Service not found</p>
	{/if}
</div>
