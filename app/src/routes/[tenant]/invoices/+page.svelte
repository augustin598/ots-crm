<script lang="ts">
	import { getInvoices, createInvoice, deleteInvoice, markInvoiceAsPaid } from '$lib/remotes/invoices.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
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
	import PlusIcon from '@lucide/svelte/icons/plus';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SendIcon from '@lucide/svelte/icons/send';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

	const tenantSlug = $derived(page.params.tenant);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);
	const error = $derived(invoicesQuery.error);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((client) => [client.id, client.name])));

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	let isDialogOpen = $state(false);
	let formClientId = $state('');
	let formProjectId = $state('');
	let formAmount = $state('');
	let formIssueDate = $state(new Date().toISOString().split('T')[0]);
	let formDueDate = $state('');
	let formStatus = $state('draft');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

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
				status: formStatus || undefined,
				issueDate: formIssueDate || undefined,
				dueDate: formDueDate || undefined
			});

			// Reset form
			formClientId = '';
			formProjectId = '';
			formAmount = '';
			formIssueDate = new Date().toISOString().split('T')[0];
			formDueDate = '';
			formStatus = 'draft';
			isDialogOpen = false;
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
			await deleteInvoice(invoiceId);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete invoice');
		}
	}

	async function handleMarkAsPaid(invoiceId: string) {
		try {
			await markInvoiceAsPaid(invoiceId);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to mark invoice as paid');
		}
	}

	function handleSendReminder(invoiceId: string) {
		// Placeholder - can be implemented later
		alert('Send reminder functionality coming soon');
	}
</script>

<svelte:head>
	<title>Invoices - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Invoices</h1>
			<p class="text-muted-foreground mt-1">Create and manage client invoices</p>
		</div>
		<Dialog bind:open={isDialogOpen}>
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
						<Select type="single" bind:value={formClientId}>
							<SelectTrigger id="client">
								{#if formClientId && clientMap.has(formClientId)}
									{clientMap.get(formClientId)}
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
						<Label for="project">Project (Optional)</Label>
						<Select type="single" bind:value={formProjectId}>
							<SelectTrigger id="project">
								{#if formProjectId}
									{projects.find((p) => p.id === formProjectId)?.name || 'Select a project'}
								{:else}
									Select a project
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">None</SelectItem>
								{#each projects as project}
									<SelectItem value={project.id}>{project.name}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
					<div class="grid gap-2">
						<Label for="amount">Amount</Label>
						<Input id="amount" type="number" bind:value={formAmount} placeholder="15000" step="0.01" />
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
					<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
					<Button onclick={handleCreateInvoice} disabled={formLoading}>
						{formLoading ? 'Creating...' : 'Create Invoice'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	</div>

	{#if loading}
		<p>Loading invoices...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">
				{error instanceof Error ? error.message : 'Failed to load invoices'}
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
										€{((invoice.totalAmount || 0) / 100).toLocaleString('en-US', {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2
										})}
									</p>
								</div>

								<div>
									<p class="text-xs text-muted-foreground mb-1">Issue Date</p>
									<p class="text-sm font-medium">
										{invoice.issueDate
											? new Date(invoice.issueDate).toLocaleDateString()
											: '-'}
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
										<DropdownMenuItem onclick={() => handleMarkAsPaid(invoice.id)}>
											Mark as Paid
										</DropdownMenuItem>
									{/if}
									{#if invoice.status !== 'paid' && invoice.status !== 'cancelled'}
										<DropdownMenuItem onclick={() => handleSendReminder(invoice.id)}>
											Send Reminder
										</DropdownMenuItem>
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
</div>
