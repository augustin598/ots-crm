<script lang="ts">
	import { getInvoice, updateInvoice, getInvoices } from '$lib/remotes/invoices.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';

	const tenantSlug = $derived(page.params.tenant);
	const invoiceId = $derived(page.params.invoiceId || '');

	const invoiceQuery = getInvoice(invoiceId);
	const invoice = $derived(invoiceQuery.current);
	const loading = $derived(invoiceQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	let clientId = $state('');
	let projectId = $state('');
	let amount = $state('');
	let taxRate = $state('19');
	let currency = $state<Currency>('RON');
	let status = $state('draft');
	let issueDate = $state('');
	let dueDate = $state('');
	let notes = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (invoice) {
			clientId = invoice.clientId || '';
			projectId = invoice.projectId || '';
			amount = invoice.amount ? (invoice.amount / 100).toString() : '';
			taxRate = invoice.taxRate ? (invoice.taxRate / 100).toString() : '19';
			currency = (invoice.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
			status = invoice.status || 'draft';
			issueDate = invoice.issueDate ? new Date(invoice.issueDate).toISOString().split('T')[0] : '';
			dueDate = invoice.dueDate ? new Date(invoice.dueDate).toISOString().split('T')[0] : '';
			notes = invoice.notes || '';
		}
	});

	$effect(() => {
		if (invoiceSettings && !invoice) {
			currency = (invoiceSettings.defaultCurrency || 'RON') as Currency;
		}
	});

	async function handleSubmit() {
		if (!clientId) {
			error = 'Please select a client';
			return;
		}
		if (!amount) {
			error = 'Please enter an amount';
			return;
		}

		saving = true;
		error = null;

		try {
			await updateInvoice({
				invoiceId,
				clientId,
				projectId: projectId || undefined,
				amount: parseFloat(amount),
				taxRate: parseFloat(taxRate),
				currency: currency,
				status: status || undefined,
				issueDate: issueDate || undefined,
				dueDate: dueDate || undefined,
				notes: notes || undefined
			}).updates(invoiceQuery, getInvoice(invoiceId), getInvoices({}));

			goto(`/${tenantSlug}/invoices/${invoiceId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update invoice';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Edit Invoice - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading invoice...</p>
	{:else if invoice}
		<h1 class="text-3xl font-bold">Edit Invoice</h1>

		<Card>
			<CardHeader>
				<CardTitle>Invoice Information</CardTitle>
				<CardDescription>Update invoice details</CardDescription>
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
						<Label for="clientId">Client *</Label>
						<Combobox
							bind:value={clientId}
							options={clientOptions}
							placeholder="Select a client"
							searchPlaceholder="Search clients..."
						/>
					</div>
					<div class="grid gap-2">
						<Label for="projectId">Project</Label>
						<Combobox
							bind:value={projectId}
							options={projectOptions}
							placeholder="Select a project (optional)"
							searchPlaceholder="Search projects..."
						/>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-2">
							<Label for="amount">Amount *</Label>
							<Input id="amount" type="number" bind:value={amount} step="0.01" required />
						</div>
						<div class="grid gap-2">
							<Label for="currency">Currency</Label>
							<Select type="single" bind:value={currency}>
								<SelectTrigger>
									{CURRENCY_LABELS[currency]}
								</SelectTrigger>
								<SelectContent>
									{#each CURRENCIES as curr}
										<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="taxRate">Tax Rate (%)</Label>
						<Input id="taxRate" type="number" bind:value={taxRate} step="0.01" />
					</div>
					<div class="grid gap-2">
						<Label for="status">Status</Label>
						<Select type="single" bind:value={status}>
							<SelectTrigger>
								{#if status === 'draft'}
									Draft
								{:else if status === 'sent'}
									Sent
								{:else if status === 'paid'}
									Paid
								{:else if status === 'overdue'}
									Overdue
								{:else if status === 'cancelled'}
									Cancelled
								{:else}
									Select status
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="draft">Draft</SelectItem>
								<SelectItem value="sent">Sent</SelectItem>
								<SelectItem value="paid">Paid</SelectItem>
								<SelectItem value="overdue">Overdue</SelectItem>
								<SelectItem value="cancelled">Cancelled</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-2">
							<Label for="issueDate">Issue Date</Label>
							<Input id="issueDate" type="date" bind:value={issueDate} />
						</div>
						<div class="grid gap-2">
							<Label for="dueDate">Due Date</Label>
							<Input id="dueDate" type="date" bind:value={dueDate} />
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="notes">Notes</Label>
						<Textarea id="notes" bind:value={notes} />
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/invoices/${invoiceId}`)}>
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
		<p>Invoice not found</p>
	{/if}
</div>
