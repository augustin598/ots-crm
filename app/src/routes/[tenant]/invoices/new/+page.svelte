<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import { createInvoiceFromService, createInvoice, getInvoices } from '$lib/remotes/invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { getPlugins } from '$lib/remotes/plugins.remote';
	import { getKeezItems } from '$lib/remotes/keez.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import InvoiceLineItemEditor from '$lib/components/app/invoice-line-item-editor.svelte';
	import { CURRENCIES, type Currency } from '$lib/utils/currency';
	import type { KeezItem } from '$lib/server/plugins/keez/client';

	const tenantSlug = $derived(page.params.tenant);

	// Data queries
	const clientsQuery = $derived(getClients());
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = $derived(getProjects(undefined));
	const projects = $derived(projectsQuery.current || []);
	const servicesQuery = $derived(getServices({}));
	const services = $derived(servicesQuery.current || []);
	const invoiceSettingsQuery = $derived(getInvoiceSettings());
	const invoiceSettings = $derived(invoiceSettingsQuery.current);
	const pluginsQuery = $derived(getPlugins());
	const plugins = $derived(pluginsQuery.current || []);

	// Plugin detection
	const isKeezActive = $derived(plugins.some((p) => p.name === 'keez' && p.enabled));
	let keezItemsQuery = $derived(isKeezActive ? getKeezItems({ count: 1000 }) : {
		current: {data: []},
		loading: false,
		error: null
	});
	const keezItems = $derived(keezItemsQuery?.current?.data || []);

	$inspect(keezItems);

	// Refresh Keez items when a new one is created
	function handleKeezItemCreated(newItem: KeezItem) {
		// Refresh the query to get updated items list
		if (isKeezActive) {
			keezItemsQuery = getKeezItems({ count: 1000 });
		}
	}

	// Form state
	let clientId = $state('');
	let sourceType = $state<'service' | 'project' | 'manual'>('manual');
	let serviceId = $state('');
	let projectId = $state('');
	let currency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let issueDate = $state(new Date().toISOString().split('T')[0]);
	let dueDate = $state('');
	let notes = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Line items state
	interface LineItem {
		id: string;
		description: string;
		quantity: number;
		rate: number;
		taxRate?: number;
		keezItem?: KeezItem;
	}

	let lineItems = $state<LineItem[]>([]);

	// Update currency when settings load
	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			currency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	// Auto-set due date
	$effect(() => {
		if (dueDate === '' && issueDate) {
			const date = new Date(issueDate);
			date.setDate(date.getDate() + 30);
			dueDate = date.toISOString().split('T')[0];
		}
	});

	// Filter services and projects by selected client
	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const filteredServices = $derived(
		clientId ? services.filter((s) => s.clientId === clientId) : services
	);
	const filteredProjects = $derived(
		clientId ? projects.filter((p) => p.clientId === clientId) : projects
	);

	const serviceOptions = $derived(filteredServices.map((s) => ({ value: s.id, label: s.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...filteredProjects.map((p) => ({ value: p.id, label: p.name }))
	]);

	// Get default tax rate from settings
	const defaultTaxRate = $derived(invoiceSettings?.defaultTaxRate ?? 19);

	// When service is selected, populate line items
	$effect(() => {
		if (sourceType === 'service' && serviceId) {
			const service = services.find((s) => s.id === serviceId);
			if (service) {
				lineItems = [
					{
						id: crypto.randomUUID(),
						description: service.name,
						quantity: 1,
						rate: service.price ? service.price / 100 : 0,
						taxRate: defaultTaxRate
					}
				];
				if (service.currency) {
					currency = service.currency as Currency;
				}
			}
		} else if (sourceType === 'service' && !serviceId) {
			lineItems = [];
		}
	});

	// When project is selected, allow manual line items
	$effect(() => {
		if (sourceType === 'project' && projectId) {
			const project = projects.find((p) => p.id === projectId);
			if (project && project.currency) {
				currency = project.currency as Currency;
			}
		}
	});

	// Calculate totals
	const subtotal = $derived(
		lineItems.reduce((sum, item) => sum + item.quantity * item.rate, 0)
	);
	const taxTotal = $derived(
		lineItems.reduce(
			(sum, item) => sum + (item.quantity * item.rate * (item.taxRate || defaultTaxRate)) / 100,
			0
		)
	);
	const grandTotal = $derived(subtotal + taxTotal);

	function updateLineItems(items: LineItem[]) {
		lineItems = items;
	}

	function removeLineItem(id: string) {
		lineItems = lineItems.filter((item) => item.id !== id);
	}

	async function handleSubmit() {
		if (!clientId) {
			error = 'Please select a client';
			return;
		}

		if (sourceType === 'service' && !serviceId) {
			error = 'Please select a service';
			return;
		}

		if (sourceType === 'project' && !projectId) {
			error = 'Please select a project';
			return;
		}

		if (sourceType === 'manual' && lineItems.length === 0) {
			error = 'Please add at least one line item';
			return;
		}

		if (lineItems.length > 0 && lineItems.some((item) => !item.description.trim())) {
			error = 'All line items must have a description';
			return;
		}

		loading = true;
		error = null;

		try {
			let result;

			if (sourceType === 'service' && serviceId) {
				// Create from service
				result = await createInvoiceFromService(serviceId).updates(getInvoices({}));
			} else {
				// Create with line items
				result = await createInvoice({
					clientId,
					projectId: sourceType === 'project' ? projectId : undefined,
					serviceId: sourceType === 'service' ? serviceId : undefined,
					lineItems: lineItems.map((item) => ({
						description: item.description,
						quantity: item.quantity,
						rate: item.rate,
						taxRate: item.taxRate
					})),
					currency: currency || undefined,
					issueDate: issueDate || undefined,
					dueDate: dueDate || undefined,
					notes: notes || undefined
				}).updates(getInvoices({}));
			}

			if (result.success) {
				goto(`/${tenantSlug}/invoices`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create invoice';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Invoice</h1>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		class="space-y-6"
	>
		<!-- Client Selection -->
		<Card>
			<CardHeader>
				<CardTitle>Client</CardTitle>
				<CardDescription>Select the client for this invoice</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-2">
					<Label>Client *</Label>
					<Combobox
						bind:value={clientId}
						options={clientOptions}
						placeholder="Select a client"
						searchPlaceholder="Search clients..."
					/>
				</div>
			</CardContent>
		</Card>

		{#if clientId}
			<!-- Source Selection -->
			<Card>
				<CardHeader>
					<CardTitle>Invoice Source</CardTitle>
					<CardDescription>Choose how to create this invoice</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs bind:value={sourceType} class="w-full">
						<TabsList class="grid w-full grid-cols-3">
							<TabsTrigger value="service">From Service</TabsTrigger>
							<TabsTrigger value="project">From Project</TabsTrigger>
							<TabsTrigger value="manual">Manual</TabsTrigger>
						</TabsList>

						<TabsContent value="service" class="space-y-4 mt-4">
							<div class="space-y-2">
								<Label>Service *</Label>
								<Combobox
									bind:value={serviceId}
									options={serviceOptions}
									placeholder="Select a service"
									searchPlaceholder="Search services..."
								/>
							</div>
							{#if serviceId}
								{@const service = services.find((s) => s.id === serviceId)}
								{#if service}
									<div class="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3">
										<p class="text-sm text-blue-800 dark:text-blue-200">
											Invoice will be created from service: <strong>{service.name}</strong>
										</p>
										{#if service.description}
											<p class="text-xs text-blue-600 dark:text-blue-300 mt-1">
												{service.description}
											</p>
										{/if}
									</div>
								{/if}
							{/if}
						</TabsContent>

						<TabsContent value="project" class="space-y-4 mt-4">
							<div class="space-y-2">
								<Label>Project *</Label>
								<Combobox
									bind:value={projectId}
									options={projectOptions.filter((p) => p.value !== '')}
									placeholder="Select a project"
									searchPlaceholder="Search projects..."
								/>
							</div>
							{#if projectId}
								{@const project = projects.find((p) => p.id === projectId)}
								{#if project}
									<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
										<p class="text-sm text-green-800 dark:text-green-200">
											Project: <strong>{project.name}</strong>
										</p>
										{#if project.description}
											<p class="text-xs text-green-600 dark:text-green-300 mt-1">
												{project.description}
											</p>
										{/if}
									</div>
								{/if}
							{/if}
						</TabsContent>

						<TabsContent value="manual" class="mt-4">
							<p class="text-sm text-muted-foreground">
								Create invoice manually by adding line items below.
							</p>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>

			<!-- Line Items -->
			{#if sourceType !== 'service' || (sourceType === 'service' && serviceId)}
				<Card>
					<CardHeader>
						<CardTitle>Line Items</CardTitle>
						<CardDescription>Add items or services to invoice</CardDescription>
					</CardHeader>
					<CardContent>
						<InvoiceLineItemEditor
							{lineItems}
							keezItems={isKeezActive ? keezItems : []}
							isKeezActive={isKeezActive}
							onUpdate={updateLineItems}
							onRemove={removeLineItem}
							onKeezItemCreated={handleKeezItemCreated}
							{currency}
							defaultTaxRate={defaultTaxRate}
						/>

						{#if lineItems.length > 0}
							<div class="mt-6 border-t pt-4 space-y-2">
								<div class="flex justify-between text-sm">
									<span class="text-muted-foreground">Subtotal:</span>
									<span class="font-medium">{subtotal.toFixed(2)} {currency}</span>
								</div>
								<div class="flex justify-between text-sm">
									<span class="text-muted-foreground">Tax:</span>
									<span class="font-medium">{taxTotal.toFixed(2)} {currency}</span>
								</div>
								<div class="flex justify-between text-lg font-bold border-t pt-2">
									<span>Total:</span>
									<span>{grandTotal.toFixed(2)} {currency}</span>
								</div>
							</div>
						{/if}
					</CardContent>
				</Card>
			{/if}

			<!-- Invoice Details -->
			<Card>
				<CardHeader>
					<CardTitle>Invoice Details</CardTitle>
					<CardDescription>Dates, currency, and payment information</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="issueDate">Issue Date *</Label>
							<Input id="issueDate" bind:value={issueDate} type="date" required />
						</div>
						<div class="space-y-2">
							<Label for="dueDate">Due Date *</Label>
							<Input id="dueDate" bind:value={dueDate} type="date" required />
						</div>
					</div>

					<div class="space-y-2">
						<Label for="currency">Currency</Label>
						<Select type="single" bind:value={currency}>
							<SelectTrigger id="currency">
								{currency}
							</SelectTrigger>
							<SelectContent>
								{#each CURRENCIES as curr}
									<SelectItem value={curr}>{curr}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>

					<div class="space-y-2">
						<Label for="notes">Invoice Notes</Label>
						<Textarea
							id="notes"
							bind:value={notes}
							placeholder="Add any additional notes or terms for this invoice..."
							rows={4}
						/>
					</div>
				</CardContent>
			</Card>
		{/if}

		{#if error}
			<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
				<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
			</div>
		{/if}

		<div class="flex items-center justify-end gap-4">
			<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/invoices`)}>
				Cancel
			</Button>
			<Button
				type="submit"
				disabled={loading || !clientId || (sourceType !== 'service' && lineItems.length === 0)}
			>
				{loading ? 'Creating...' : 'Create Invoice'}
			</Button>
		</div>
	</form>
</div>
