<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import { createInvoiceFromService, createInvoice, getInvoices } from '$lib/remotes/invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { FormSection } from '$lib/components/app/form-section';
	import { Progress } from '$lib/components/ui/progress/index';
	import { CURRENCIES, type Currency } from '$lib/utils/currency';

	const tenantSlug = $derived(page.params.tenant);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const servicesQuery = getServices({});
	const services = $derived(servicesQuery.current || []);
	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	let clientId = $state('');
	let projectId = $state('');
	let serviceId = $state('');
	let amount = $state('');
	let taxRate = $state('19');
	let currency = $state<Currency>(invoiceSettings?.defaultCurrency || 'RON');
	let issueDate = $state(new Date().toISOString().split('T')[0]);
	let dueDate = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Update currency when settings load
	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			currency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	// Section completion states
	let clientInfoCompleted = $derived(!!clientId);
	let invoiceDetailsCompleted = $derived(!!(serviceId || amount));

	const completedSections = $derived((clientInfoCompleted ? 1 : 0) + (invoiceDetailsCompleted ? 1 : 0));
	const totalSections = 2;
	const progress = $derived((completedSections / totalSections) * 100);

	$effect(() => {
		if (dueDate === '' && issueDate) {
			const date = new Date(issueDate);
			date.setDate(date.getDate() + 30);
			dueDate = date.toISOString().split('T')[0];
		}
	});

	async function handleSubmit() {
		if (!clientId) {
			error = 'Please select a client';
			return;
		}

		loading = true;
		error = null;

		try {
			let result;
			if (serviceId) {
				result = await createInvoiceFromService(serviceId).updates(getInvoices({}));
			} else {
				if (!amount) {
					error = 'Amount is required for manual invoices';
					loading = false;
					return;
				}
				result = await createInvoice({
					clientId,
					projectId: projectId || undefined,
					amount: parseFloat(amount),
					taxRate: parseFloat(taxRate) || undefined,
					currency: currency || undefined,
					issueDate: issueDate || undefined,
					dueDate: dueDate || undefined
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

	<Card>
		<CardHeader>
			<CardTitle>Invoice Information</CardTitle>
			<CardDescription>Create a new invoice</CardDescription>
			<div class="mt-4 space-y-2">
				<div class="flex items-center justify-between text-sm">
					<span class="text-muted-foreground">Progress</span>
					<span class="font-medium">{completedSections} of {totalSections} sections completed</span>
				</div>
				<Progress value={progress} class="h-2" />
			</div>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<FormSection
					title="Client & Service"
					description="Select client and optionally create from service"
					bind:completed={clientInfoCompleted}
					defaultOpen={true}
				>
					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="clientId">Client *</Label>
							<Combobox
								bind:value={clientId}
								options={clientOptions}
								placeholder="Select a client"
								searchPlaceholder="Search clients..."
							/>
						</div>
						<div class="space-y-2">
							<Label for="serviceId">Service</Label>
							<Select type="single" bind:value={serviceId}>
								<SelectTrigger>
									{#if serviceId}
										{services.find((s) => s.id === serviceId)?.name || 'Select a service'}
									{:else}
										Select a service (optional)
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="">Create manually</SelectItem>
									{#each services as service}
										<SelectItem value={service.id}>{service.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						{#if serviceId}
							<div class="rounded-md bg-blue-50 p-3">
								<p class="text-sm text-blue-800">Invoice will be created from the selected service</p>
							</div>
						{/if}
					</div>
				</FormSection>

				{#if !serviceId}
					<FormSection
						title="Invoice Details"
						description="Amount, dates, and tax information"
						bind:completed={invoiceDetailsCompleted}
						defaultOpen={false}
					>
						<div class="space-y-4">
							<div class="space-y-2">
								<Label for="projectId">Project</Label>
								<Combobox
									bind:value={projectId}
									options={projectOptions}
									placeholder="Select a project (optional)"
									searchPlaceholder="Search projects..."
								/>
							</div>
							<div class="grid grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label for="amount">Amount *</Label>
									<Input id="amount" bind:value={amount} type="number" step="0.01" />
								</div>
								<div class="space-y-2">
									<Label for="currency">Currency</Label>
									<Select type="single" bind:value={currency}>
										<SelectTrigger>
											{currency}
										</SelectTrigger>
										<SelectContent>
											{#each CURRENCIES as curr}
												<SelectItem value={curr}>{curr}</SelectItem>
											{/each}
										</SelectContent>
									</Select>
								</div>
							</div>
							<div class="space-y-2">
								<Label for="taxRate">Tax Rate (%)</Label>
								<Input id="taxRate" bind:value={taxRate} type="number" step="0.01" />
							</div>
							<div class="grid grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label for="issueDate">Issue Date</Label>
									<Input id="issueDate" bind:value={issueDate} type="date" />
								</div>
								<div class="space-y-2">
									<Label for="dueDate">Due Date</Label>
									<Input id="dueDate" bind:value={dueDate} type="date" />
								</div>
							</div>
						</div>
					</FormSection>
				{/if}

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/invoices`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading || (!serviceId && !amount)}>
						{loading ? 'Creating...' : 'Create Invoice'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
