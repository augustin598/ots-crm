<script lang="ts">
	import {
		getInvoices,
		createInvoice,
		deleteInvoice,
		markInvoiceAsPaid,
		getInvoice
	} from '$lib/remotes/invoices.remote';
	import {
		getRecurringInvoices,
		createRecurringInvoice,
		updateRecurringInvoice,
		deleteRecurringInvoice,
		toggleRecurringInvoiceActive,
		triggerRecurringInvoice
	} from '$lib/remotes/recurring-invoices.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { page } from '$app/state';
	import { formatAmount, CURRENCIES, type Currency } from '$lib/utils/currency';
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
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SendIcon from '@lucide/svelte/icons/send';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import EditIcon from '@lucide/svelte/icons/edit';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PowerIcon from '@lucide/svelte/icons/power';
	import PowerOffIcon from '@lucide/svelte/icons/power-off';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { goto } from '$app/navigation';

	const tenantSlug = $derived(page.params.tenant);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const invoicesLoading = $derived(invoicesQuery.loading);
	const invoicesError = $derived(invoicesQuery.error);

	const recurringInvoicesQuery = getRecurringInvoices({});
	const recurringInvoices = $derived(recurringInvoicesQuery.current || []);
	const recurringInvoicesLoading = $derived(recurringInvoicesQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((client) => [client.id, client.name])));

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const servicesQuery = getServices({});
	const services = $derived(servicesQuery.current || []);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const serviceOptions = $derived([
		{ value: '', label: 'None' },
		...services.map((s) => ({ value: s.id, label: s.name }))
	]);

	// Invoice dialog state
	let isInvoiceDialogOpen = $state(false);
	let formClientId = $state('');
	let formProjectId = $state('');
	let formAmount = $state('');
	let formCurrency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let formIssueDate = $state(new Date().toISOString().split('T')[0]);
	let formDueDate = $state('');
	let formStatus = $state('draft');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	// Recurring invoice dialog state
	let isRecurringDialogOpen = $state(false);
	let isEditingRecurring = $state(false);
	let editingRecurringId = $state<string | null>(null);
	let recurringName = $state('');
	let recurringClientId = $state('');
	let recurringProjectId = $state('');
	let recurringServiceId = $state('');
	let recurringAmount = $state('');
	let recurringTaxRate = $state('19');
	let recurringCurrency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let recurringType = $state<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
	let recurringInterval = $state('1');
	let recurringStartDate = $state(new Date().toISOString().split('T')[0]);
	let recurringEndDate = $state('');
	let recurringIssueDateOffset = $state('0');
	let recurringDueDateOffset = $state('30');
	let recurringNotes = $state('');
	let recurringIsActive = $state(true);
	let recurringFormLoading = $state(false);
	let recurringError = $state<string | null>(null);

	// Update currency when settings load
	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			formCurrency = invoiceSettings.defaultCurrency as Currency;
			recurringCurrency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	// Pre-fill amount from service if selected
	$effect(() => {
		if (recurringServiceId) {
			const service = services.find((s) => s.id === recurringServiceId);
			if (service && service.price) {
				recurringAmount = (service.price / 100).toString();
				recurringCurrency = (service.currency as Currency) || recurringCurrency;
			}
		}
	});

	$effect(() => {
		if (formDueDate === '' && formIssueDate) {
			const date = new Date(formIssueDate);
			date.setDate(date.getDate() + 30);
			formDueDate = date.toISOString().split('T')[0];
		}
	});

	function getStatusColor(status: string) {
		switch (status) {
			case 'paid':
				return 'default';
			case 'sent':
				return 'secondary';
			case 'draft':
				return 'outline';
			case 'overdue':
				return 'destructive';
			case 'cancelled':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'paid':
				return '✓';
			case 'overdue':
				return '!';
			default:
				return '';
		}
	}

	function formatRecurringPattern(recurringType: string, interval: number): string {
		const typeMap: Record<string, string> = {
			daily: 'Day',
			weekly: 'Week',
			monthly: 'Month',
			yearly: 'Year'
		};

		const type = typeMap[recurringType] || recurringType;
		if (interval === 1) {
			return `Every ${type}`;
		}
		return `Every ${interval} ${type}s`;
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return 'N/A';
		return new Date(date).toLocaleDateString('ro-RO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	// Invoice handlers
	async function handleCreateInvoice() {
		if (!formClientId) {
			formError = 'Please select a client';
			return;
		}
		if (!formAmount) {
			formError = 'Please enter an amount';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await createInvoice({
				clientId: formClientId,
				projectId: formProjectId || undefined,
				amount: parseFloat(formAmount),
				currency: formCurrency || undefined,
				status: formStatus || undefined,
				issueDate: formIssueDate || undefined,
				dueDate: formDueDate || undefined
			}).updates(invoicesQuery);

			// Reset form
			formClientId = '';
			formProjectId = '';
			formAmount = '';
			formCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
			formIssueDate = new Date().toISOString().split('T')[0];
			formDueDate = '';
			formStatus = 'draft';
			isInvoiceDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create invoice';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteInvoice(invoiceId: string) {
		if (!confirm('Are you sure you want to delete this invoice?')) {
			return;
		}

		try {
			await deleteInvoice(invoiceId).updates(invoicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete invoice');
		}
	}

	async function handleMarkAsPaid(invoiceId: string) {
		try {
			await markInvoiceAsPaid(invoiceId).updates(invoicesQuery, getInvoices({}));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to mark invoice as paid');
		}
	}

	// Recurring invoice handlers
	function openRecurringDialog(recurringInvoiceId?: string) {
		if (recurringInvoiceId) {
			// Edit mode - find from already loaded list
			const ri = recurringInvoices.find((r) => r.id === recurringInvoiceId);
			if (ri) {
				isEditingRecurring = true;
				editingRecurringId = recurringInvoiceId;
				recurringName = ri.name || '';
				recurringClientId = ri.clientId || '';
				recurringProjectId = ri.projectId || '';
				recurringServiceId = ri.serviceId || '';
				recurringAmount = ri.amount ? (ri.amount / 100).toString() : '';
				recurringTaxRate = ri.taxRate ? (ri.taxRate / 100).toString() : '19';
				recurringCurrency = (ri.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
				recurringType = ri.recurringType as 'daily' | 'weekly' | 'monthly' | 'yearly';
				recurringInterval = ri.recurringInterval?.toString() || '1';
				recurringStartDate = ri.startDate
					? new Date(ri.startDate).toISOString().split('T')[0]
					: new Date().toISOString().split('T')[0];
				recurringEndDate = ri.endDate ? new Date(ri.endDate).toISOString().split('T')[0] : '';
				recurringIssueDateOffset = ri.issueDateOffset?.toString() || '0';
				recurringDueDateOffset = ri.dueDateOffset?.toString() || '30';
				recurringNotes = ri.notes || '';
				recurringIsActive = ri.isActive ?? true;
			}
		} else {
			// Create mode
			isEditingRecurring = false;
			editingRecurringId = null;
			recurringName = '';
			recurringClientId = '';
			recurringProjectId = '';
			recurringServiceId = '';
			recurringAmount = '';
			recurringTaxRate = '19';
			recurringCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
			recurringType = 'monthly';
			recurringInterval = '1';
			recurringStartDate = new Date().toISOString().split('T')[0];
			recurringEndDate = '';
			recurringIssueDateOffset = '0';
			recurringDueDateOffset = '30';
			recurringNotes = '';
			recurringIsActive = true;
		}
		isRecurringDialogOpen = true;
	}

	function closeRecurringDialog() {
		isRecurringDialogOpen = false;
		isEditingRecurring = false;
		editingRecurringId = null;
		recurringError = null;
	}

	async function handleCreateRecurringInvoice() {
		if (!recurringName || !recurringClientId) {
			recurringError = 'Name and client are required';
			return;
		}
		if (!recurringAmount) {
			recurringError = 'Amount is required';
			return;
		}
		if (!recurringStartDate) {
			recurringError = 'Start date is required';
			return;
		}

		recurringFormLoading = true;
		recurringError = null;

		try {
			if (isEditingRecurring && editingRecurringId) {
				await updateRecurringInvoice({
					recurringInvoiceId: editingRecurringId,
					name: recurringName,
					clientId: recurringClientId,
					projectId: recurringProjectId || undefined,
					serviceId: recurringServiceId || undefined,
					amount: parseFloat(recurringAmount),
					taxRate: parseFloat(recurringTaxRate) || undefined,
					currency: recurringCurrency || undefined,
					recurringType,
					recurringInterval: parseInt(recurringInterval) || 1,
					startDate: recurringStartDate,
					endDate: recurringEndDate || undefined,
					issueDateOffset: parseInt(recurringIssueDateOffset) || 0,
					dueDateOffset: parseInt(recurringDueDateOffset) || 30,
					notes: recurringNotes || undefined,
					isActive: recurringIsActive
				}).updates(recurringInvoicesQuery);
			} else {
				await createRecurringInvoice({
					name: recurringName,
					clientId: recurringClientId,
					projectId: recurringProjectId || undefined,
					serviceId: recurringServiceId || undefined,
					amount: parseFloat(recurringAmount),
					taxRate: parseFloat(recurringTaxRate) || undefined,
					currency: recurringCurrency || undefined,
					recurringType,
					recurringInterval: parseInt(recurringInterval) || 1,
					startDate: recurringStartDate,
					endDate: recurringEndDate || undefined,
					issueDateOffset: parseInt(recurringIssueDateOffset) || 0,
					dueDateOffset: parseInt(recurringDueDateOffset) || 30,
					notes: recurringNotes || undefined,
					isActive: recurringIsActive
				}).updates(recurringInvoicesQuery);
			}
			closeRecurringDialog();
		} catch (e) {
			recurringError = e instanceof Error ? e.message : 'Failed to save recurring invoice';
		} finally {
			recurringFormLoading = false;
		}
	}

	async function handleDeleteRecurring(recurringInvoiceId: string) {
		if (!confirm('Are you sure you want to delete this recurring invoice?')) {
			return;
		}

		try {
			await deleteRecurringInvoice(recurringInvoiceId).updates(recurringInvoicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete recurring invoice');
		}
	}

	async function handleToggleActive(recurringInvoiceId: string) {
		try {
			await toggleRecurringInvoiceActive(recurringInvoiceId).updates(recurringInvoicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to toggle recurring invoice');
		}
	}

	async function handleTriggerRecurring(recurringInvoiceId: string) {
		if (!confirm('Generate an invoice now from this template?')) {
			return;
		}

		try {
			await triggerRecurringInvoice(recurringInvoiceId).updates(recurringInvoicesQuery, invoicesQuery);
			alert('Invoice generated successfully!');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to generate invoice');
		}
	}
</script>

<svelte:head>
	<title>Invoices - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Invoices</h1>
			<p class="text-muted-foreground mt-1">Create and manage invoices and recurring invoice templates</p>
		</div>
		<div class="flex gap-2">
			<Dialog bind:open={isRecurringDialogOpen}>
				<DialogTrigger>
					<Button variant="outline" onclick={() => openRecurringDialog()}>
						<RepeatIcon class="mr-2 h-4 w-4" />
						New Recurring Invoice
					</Button>
				</DialogTrigger>
				<DialogContent class="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{isEditingRecurring ? 'Edit Recurring Invoice' : 'Create Recurring Invoice'}
						</DialogTitle>
						<DialogDescription>
							{isEditingRecurring
								? 'Update recurring invoice template'
								: 'Create a template for automatically generating invoices'}
						</DialogDescription>
					</DialogHeader>
					<div class="grid gap-4 py-4">
						<div class="grid gap-2">
							<Label for="recurringName">Name *</Label>
							<Input
								id="recurringName"
								bind:value={recurringName}
								placeholder="e.g., Monthly Subscription"
								required
							/>
						</div>
						<div class="grid gap-2">
							<Label for="recurringClient">Client *</Label>
							<Combobox
								bind:value={recurringClientId}
								options={clientOptions}
								placeholder="Select a client"
								searchPlaceholder="Search clients..."
							/>
						</div>
						<div class="grid gap-2">
							<Label for="recurringProject">Project</Label>
							<Combobox
								bind:value={recurringProjectId}
								options={projectOptions}
								placeholder="Select a project (optional)"
								searchPlaceholder="Search projects..."
							/>
						</div>
						<div class="grid gap-2">
							<Label for="recurringService">Service</Label>
							<Select type="single" bind:value={recurringServiceId}>
								<SelectTrigger>
									{#if recurringServiceId}
										{services.find((s) => s.id === recurringServiceId)?.name || 'Select a service'}
									{:else}
										Select a service (optional)
									{/if}
								</SelectTrigger>
								<SelectContent>
									{#each serviceOptions as option}
										<SelectItem value={option.value}>{option.label}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
							<p class="text-xs text-muted-foreground">
								If selected, amount and currency will be pre-filled from the service
							</p>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="grid gap-2">
								<Label for="recurringAmount">Amount *</Label>
								<Input
									id="recurringAmount"
									bind:value={recurringAmount}
									type="number"
									step="0.01"
									required
								/>
							</div>
							<div class="grid gap-2">
								<Label for="recurringCurrency">Currency</Label>
								<Select type="single" bind:value={recurringCurrency}>
									<SelectTrigger>{recurringCurrency}</SelectTrigger>
									<SelectContent>
										{#each CURRENCIES as curr}
											<SelectItem value={curr}>{curr}</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div class="grid gap-2">
							<Label for="recurringTaxRate">Tax Rate (%)</Label>
							<Input id="recurringTaxRate" bind:value={recurringTaxRate} type="number" step="0.01" />
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="grid gap-2">
								<Label for="recurringType">Recurring Type *</Label>
								<Select type="single" bind:value={recurringType}>
									<SelectTrigger>
										{recurringType.charAt(0).toUpperCase() + recurringType.slice(1)}
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="daily">Daily</SelectItem>
										<SelectItem value="weekly">Weekly</SelectItem>
										<SelectItem value="monthly">Monthly</SelectItem>
										<SelectItem value="yearly">Yearly</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div class="grid gap-2">
								<Label for="recurringInterval">Interval *</Label>
								<Input
									id="recurringInterval"
									bind:value={recurringInterval}
									type="number"
									min="1"
									required
								/>
								<p class="text-xs text-muted-foreground">e.g., 2 = every 2 {recurringType}s</p>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="grid gap-2">
								<Label for="recurringStartDate">Start Date *</Label>
								<Input id="recurringStartDate" bind:value={recurringStartDate} type="date" required />
							</div>
							<div class="grid gap-2">
								<Label for="recurringEndDate">End Date</Label>
								<Input id="recurringEndDate" bind:value={recurringEndDate} type="date" />
								<p class="text-xs text-muted-foreground">Leave empty for no end date</p>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="grid gap-2">
								<Label for="recurringIssueDateOffset">Issue Date Offset (days)</Label>
								<Input
									id="recurringIssueDateOffset"
									bind:value={recurringIssueDateOffset}
									type="number"
									placeholder="0"
								/>
								<p class="text-xs text-muted-foreground">
									Days to add to generation date for issue date
								</p>
							</div>
							<div class="grid gap-2">
								<Label for="recurringDueDateOffset">Due Date Offset (days)</Label>
								<Input
									id="recurringDueDateOffset"
									bind:value={recurringDueDateOffset}
									type="number"
									placeholder="30"
								/>
								<p class="text-xs text-muted-foreground">Days to add to issue date for due date</p>
							</div>
						</div>
						<div class="grid gap-2">
							<Label for="recurringNotes">Notes</Label>
							<Textarea
								id="recurringNotes"
								bind:value={recurringNotes}
								placeholder="Optional notes for generated invoices"
							/>
						</div>
						<div class="flex items-center space-x-2">
							<Switch id="recurringIsActive" bind:checked={recurringIsActive} />
							<Label for="recurringIsActive" class="cursor-pointer">Active</Label>
							<p class="text-sm text-muted-foreground">
								Inactive recurring invoices will not generate new invoices
							</p>
						</div>
					</div>
					{#if recurringError}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{recurringError}</p>
						</div>
					{/if}
					<DialogFooter>
						<Button variant="outline" onclick={closeRecurringDialog}>Cancel</Button>
						<Button
							onclick={handleCreateRecurringInvoice}
							disabled={recurringFormLoading || !recurringName || !recurringClientId || !recurringAmount || !recurringStartDate}
						>
							{recurringFormLoading ? (isEditingRecurring ? 'Saving...' : 'Creating...') : (isEditingRecurring ? 'Save Changes' : 'Create Recurring Invoice')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog bind:open={isInvoiceDialogOpen}>
				<DialogTrigger>
					<Button>
						<PlusIcon class="mr-2 h-4 w-4" />
						New Invoice
					</Button>
				</DialogTrigger>
				<DialogContent class="sm:max-w-[600px]">
					<DialogHeader>
						<DialogTitle>Create New Invoice</DialogTitle>
						<DialogDescription>Generate a new invoice for a client</DialogDescription>
					</DialogHeader>
					<div class="grid gap-4 py-4">
						<div class="grid gap-2">
							<Label for="client">Client</Label>
							<Combobox
								bind:value={formClientId}
								options={clientOptions}
								placeholder="Select a client"
								searchPlaceholder="Search clients..."
							/>
						</div>
						<div class="grid gap-2">
							<Label for="project">Project (Optional)</Label>
							<Combobox
								bind:value={formProjectId}
								options={projectOptions}
								placeholder="Select a project (optional)"
								searchPlaceholder="Search projects..."
							/>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="grid gap-2">
								<Label for="amount">Amount</Label>
								<Input id="amount" type="number" bind:value={formAmount} placeholder="15000" step="0.01" />
							</div>
							<div class="grid gap-2">
								<Label for="currency">Currency</Label>
								<Select type="single" bind:value={formCurrency}>
									<SelectTrigger id="currency">{formCurrency}</SelectTrigger>
									<SelectContent>
										{#each CURRENCIES as curr}
											<SelectItem value={curr}>{curr}</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="grid gap-2">
								<Label for="issueDate">Issue Date</Label>
								<Input id="issueDate" type="date" bind:value={formIssueDate} />
							</div>
							<div class="grid gap-2">
								<Label for="dueDate">Due Date</Label>
								<Input id="dueDate" type="date" bind:value={formDueDate} />
							</div>
						</div>
						<div class="grid gap-2">
							<Label for="status">Status</Label>
							<Select type="single" bind:value={formStatus}>
								<SelectTrigger id="status">
									{#if formStatus === 'draft'}
										Draft
									{:else if formStatus === 'sent'}
										Sent
									{:else if formStatus === 'paid'}
										Paid
									{:else if formStatus === 'overdue'}
										Overdue
									{:else if formStatus === 'cancelled'}
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
					</div>
					{#if formError}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{formError}</p>
						</div>
					{/if}
					<DialogFooter>
						<Button variant="outline" onclick={() => (isInvoiceDialogOpen = false)}>Cancel</Button>
						<Button onclick={handleCreateInvoice} disabled={formLoading}>
							{formLoading ? 'Creating...' : 'Create Invoice'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	</div>

	<Tabs value="invoices" class="w-full">
		<TabsList>
			<TabsTrigger value="invoices">Invoices</TabsTrigger>
			<TabsTrigger value="recurring">Recurring Invoices</TabsTrigger>
		</TabsList>

		<TabsContent value="invoices" class="space-y-4">
			{#if invoicesLoading}
				<p>Loading invoices...</p>
			{:else if invoicesError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">
						{invoicesError instanceof Error ? invoicesError.message : 'Failed to load invoices'}
					</p>
				</div>
			{:else if invoices.length === 0}
				<Card>
					<div class="p-6 text-center">
						<p class="text-muted-foreground">No invoices yet. Get started by creating your first invoice.</p>
					</div>
				</Card>
			{:else}
				<div class="space-y-4">
					{#each invoices as invoice}
						<Card class="p-6">
							<div class="flex items-start justify-between">
								<div class="flex-1">
									<div class="flex items-center gap-3 mb-2">
										<h3 class="text-xl font-semibold">{invoice.invoiceNumber}</h3>
										<Badge variant={getStatusColor(invoice.status)}>
											{getStatusIcon(invoice.status)} {invoice.status}
										</Badge>
									</div>
									<p class="text-sm text-muted-foreground mb-4">
										{clientMap.get(invoice.clientId) || 'Unknown Client'}
									</p>

									<div class="grid gap-4 md:grid-cols-4">
										<div>
											<p class="text-xs text-muted-foreground mb-1">Amount</p>
											<p class="text-2xl font-bold text-primary">
												{formatAmount(invoice.totalAmount, (invoice.currency || 'RON') as Currency)}
											</p>
										</div>

										<div>
											<p class="text-xs text-muted-foreground mb-1">Issue Date</p>
											<p class="text-sm font-medium">
												{invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : '-'}
											</p>
										</div>

										<div>
											<p class="text-xs text-muted-foreground mb-1">Due Date</p>
											<p class="text-sm font-medium">
												{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '-'}
											</p>
										</div>

										{#if invoice.paidDate}
											<div>
												<p class="text-xs text-muted-foreground mb-1">Paid Date</p>
												<p class="text-sm font-medium text-green-600">
													{new Date(invoice.paidDate).toLocaleDateString()}
												</p>
											</div>
										{/if}
									</div>
								</div>

								<div class="flex items-center gap-2">
									<Button variant="outline" size="icon">
										<DownloadIcon class="h-4 w-4" />
									</Button>
									{#if invoice.status !== 'paid'}
										<Button variant="outline" size="icon">
											<SendIcon class="h-4 w-4" />
										</Button>
									{/if}
									<DropdownMenu>
										<DropdownMenuTrigger>
											<Button variant="ghost" size="icon">
												<MoreVerticalIcon class="h-4 w-4" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}/edit`)}>
												Edit
											</DropdownMenuItem>
											<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}`)}>
												View Details
											</DropdownMenuItem>
											{#if invoice.status !== 'paid'}
												<DropdownMenuItem onclick={() => handleMarkAsPaid(invoice.id)}>Mark as Paid</DropdownMenuItem>
											{/if}
											<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteInvoice(invoice.id)}>
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>
						</Card>
					{/each}
				</div>
			{/if}
		</TabsContent>

		<TabsContent value="recurring" class="space-y-4">
			{#if recurringInvoicesLoading}
				<div class="flex items-center justify-center p-8">
					<p class="text-muted-foreground">Loading recurring invoices...</p>
				</div>
			{:else if recurringInvoices.length === 0}
				<Card class="p-8 text-center">
					<p class="text-muted-foreground mb-4">No recurring invoices found.</p>
					<Button onclick={() => openRecurringDialog()}>
						<PlusIcon class="mr-2 h-4 w-4" />
						Create Your First Recurring Invoice
					</Button>
				</Card>
			{:else}
				<div class="grid gap-4">
					{#each recurringInvoices as recurringInvoice (recurringInvoice.id)}
						<Card class="p-6">
							<div class="flex items-start justify-between">
								<div class="flex-1 space-y-2">
									<div class="flex items-center gap-3">
										<h3 class="text-lg font-semibold">{recurringInvoice.name}</h3>
										<Badge variant={recurringInvoice.isActive ? 'default' : 'secondary'}>
											{recurringInvoice.isActive ? 'Active' : 'Inactive'}
										</Badge>
									</div>
									<div class="grid grid-cols-2 gap-4 text-sm">
										<div>
											<p class="text-muted-foreground">Client</p>
											<p class="font-medium">
												{clientMap.get(recurringInvoice.clientId) || 'Unknown'}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Amount</p>
											<p class="font-medium">
												{formatAmount(recurringInvoice.amount, recurringInvoice.currency as Currency)}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Recurring Pattern</p>
											<p class="font-medium">
												{formatRecurringPattern(
													recurringInvoice.recurringType,
													recurringInvoice.recurringInterval
												)}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Next Run Date</p>
											<p class="font-medium">{formatDate(recurringInvoice.nextRunDate)}</p>
										</div>
										{#if recurringInvoice.lastRunDate}
											<div>
												<p class="text-muted-foreground">Last Run Date</p>
												<p class="font-medium">{formatDate(recurringInvoice.lastRunDate)}</p>
											</div>
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
										<DropdownMenuItem
											onclick={() => handleTriggerRecurring(recurringInvoice.id)}
											disabled={!recurringInvoice.isActive}
										>
											<PlayIcon class="mr-2 h-4 w-4" />
											Generate Now
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => openRecurringDialog(recurringInvoice.id)}>
											<EditIcon class="mr-2 h-4 w-4" />
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => handleToggleActive(recurringInvoice.id)}>
											{#if recurringInvoice.isActive}
												<PowerOffIcon class="mr-2 h-4 w-4" />
												Deactivate
											{:else}
												<PowerIcon class="mr-2 h-4 w-4" />
												Activate
											{/if}
										</DropdownMenuItem>
										<DropdownMenuItem
											onclick={() => handleDeleteRecurring(recurringInvoice.id)}
											class="text-destructive"
										>
											<TrashIcon class="mr-2 h-4 w-4" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</Card>
					{/each}
				</div>
			{/if}
		</TabsContent>
	</Tabs>
</div>
