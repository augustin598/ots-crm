<script lang="ts">
	import { getExpenses, createExpense, updateExpense, deleteExpense } from '$lib/remotes/banking.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, Plus, Edit, Trash2, Filter } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const tenantSlug = $derived(page.params.tenant);

	// Filters
	let selectedClientId = $state<string>('');
	let selectedProjectId = $state<string>('');
	let fromDate = $state<string>('');
	let toDate = $state<string>('');
	let categoryFilter = $state<string>('');

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const projectsQuery = getProjects({});
	const projects = $derived(projectsQuery.current || []);

	const expensesQuery = getExpenses({
		clientId: selectedClientId || undefined,
		projectId: selectedProjectId || undefined,
		fromDate: fromDate || undefined,
		toDate: toDate || undefined,
		category: categoryFilter || undefined
	});
	const expenses = $derived(expensesQuery.current || []);

	// Dialog state
	let isDialogOpen = $state(false);
	let editingExpenseId = $state<string | null>(null);

	// Form state
	let formDescription = $state('');
	let formAmount = $state('');
	let formCurrency = $state<Currency>('RON');
	let formDate = $state(new Date().toISOString().split('T')[0]);
	let formClientId = $state<string>('');
	let formProjectId = $state<string>('');
	let formCategory = $state('');
	let formVatRate = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	function resetForm() {
		formDescription = '';
		formAmount = '';
		formCurrency = 'RON';
		formDate = new Date().toISOString().split('T')[0];
		formClientId = '';
		formProjectId = '';
		formCategory = '';
		formVatRate = '';
		formError = null;
		editingExpenseId = null;
	}

	function openCreateDialog() {
		resetForm();
		isDialogOpen = true;
	}

	function openEditDialog(expense: any) {
		editingExpenseId = expense.id;
		formDescription = expense.description;
		formAmount = ((expense.amount || 0) / 100).toString();
		formCurrency = (expense.currency || 'RON') as Currency;
		formDate = new Date(expense.date).toISOString().split('T')[0];
		formClientId = expense.clientId || '';
		formProjectId = expense.projectId || '';
		formCategory = expense.category || '';
		formVatRate = expense.vatRate ? ((expense.vatRate / 100).toString()) : '';
		formError = null;
		isDialogOpen = true;
	}

	async function handleSubmit() {
		if (!formDescription || !formAmount) {
			formError = 'Description and amount are required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			if (editingExpenseId) {
			await updateExpense({
				expenseId: editingExpenseId,
				description: formDescription,
				amount: parseFloat(formAmount),
				currency: formCurrency,
				date: formDate,
				clientId: formClientId || undefined,
				projectId: formProjectId || undefined,
				category: formCategory || undefined,
				vatRate: formVatRate ? parseFloat(formVatRate) : undefined
			}).updates(expensesQuery);
			} else {
				await createExpense({
					description: formDescription,
					amount: parseFloat(formAmount),
					currency: formCurrency,
					date: formDate,
					clientId: formClientId || undefined,
					projectId: formProjectId || undefined,
					category: formCategory || undefined,
					vatRate: formVatRate ? parseFloat(formVatRate) : undefined
				}).updates(expensesQuery);
			}
			isDialogOpen = false;
			resetForm();
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to save expense';
		} finally {
			formLoading = false;
		}
	}

	async function handleDelete(expenseId: string) {
		if (!confirm('Are you sure you want to delete this expense?')) {
			return;
		}

		try {
			await deleteExpense(expenseId).updates(expensesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete expense');
		}
	}

	function getClientName(clientId: string | null): string {
		if (!clientId) return '';
		const client = clients.find((c) => c.id === clientId);
		return client?.name || '';
	}

	function getProjectName(projectId: string | null): string {
		if (!projectId) return '';
		const project = projects.find((p) => p.id === projectId);
		return project?.name || '';
	}
</script>

<svelte:head>
	<title>Expenses - Banking</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Button variant="ghost" size="icon" onclick={() => goto(`/${tenantSlug}/banking`)}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-3xl font-bold">Expenses</h1>
				<p class="text-muted-foreground">Track and manage business expenses</p>
			</div>
		</div>
		<Button onclick={openCreateDialog}>
			<Plus class="mr-2 h-4 w-4" />
			Add Expense
		</Button>
	</div>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Filter class="h-5 w-5" />
				Filters
			</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid grid-cols-1 md:grid-cols-5 gap-4">
				<div class="space-y-2">
					<Label for="client">Client</Label>
					<Select value={selectedClientId} onValueChange={(value) => (selectedClientId = value)}>
						<SelectTrigger id="client" />
						<SelectContent>
							<SelectItem value="">All Clients</SelectItem>
							{#each clients as client}
								<SelectItem value={client.id}>{client.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="project">Project</Label>
					<Select value={selectedProjectId} onValueChange={(value) => (selectedProjectId = value)}>
						<SelectTrigger id="project" />
						<SelectContent>
							<SelectItem value="">All Projects</SelectItem>
							{#each projects as project}
								<SelectItem value={project.id}>{project.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="fromDate">From Date</Label>
					<Input id="fromDate" type="date" bind:value={fromDate} />
				</div>

				<div class="space-y-2">
					<Label for="toDate">To Date</Label>
					<Input id="toDate" type="date" bind:value={toDate} />
				</div>

				<div class="space-y-2">
					<Label for="category">Category</Label>
					<Input id="category" bind:value={categoryFilter} placeholder="Filter by category" />
				</div>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Expenses ({expenses.length})</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="space-y-4">
				{#each expenses as expense}
					<div class="flex items-center justify-between rounded-lg border p-4">
						<div class="flex-1">
							<div class="flex items-center gap-3">
								<div>
									<p class="font-semibold">{expense.description}</p>
									<p class="text-sm text-muted-foreground">
										{new Date(expense.date).toLocaleDateString()}
										{#if expense.category}
											• {expense.category}
										{/if}
										{#if getClientName(expense.clientId)}
											• {getClientName(expense.clientId)}
										{/if}
										{#if getProjectName(expense.projectId)}
											• {getProjectName(expense.projectId)}
										{/if}
									</p>
								</div>
								{#if expense.category}
									<Badge variant="secondary">{expense.category}</Badge>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-4">
							<div class="text-right">
								<p class="font-semibold text-red-600">
									-{formatAmount(expense.amount || 0, expense.currency as Currency)}
								</p>
								{#if expense.vatAmount}
									<p class="text-xs text-muted-foreground">
										VAT: {formatAmount(expense.vatAmount, expense.currency as Currency)}
									</p>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<Button variant="outline" size="sm" onclick={() => openEditDialog(expense)}>
									<Edit class="h-4 w-4" />
								</Button>
								<Button variant="destructive" size="sm" onclick={() => handleDelete(expense.id)}>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>
				{:else}
					<p class="text-center text-muted-foreground py-8">No expenses found</p>
				{/each}
			</div>
		</CardContent>
	</Card>
</div>

<Dialog bind:open={isDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{editingExpenseId ? 'Edit Expense' : 'Create Expense'}</DialogTitle>
			<DialogDescription>
				{editingExpenseId ? 'Update expense details' : 'Add a new expense'}
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<div class="space-y-2">
				<Label for="description">Description *</Label>
				<Input id="description" bind:value={formDescription} required />
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="amount">Amount *</Label>
					<Input id="amount" type="number" step="0.01" bind:value={formAmount} required />
				</div>

				<div class="space-y-2">
					<Label for="currency">Currency</Label>
					<Select value={formCurrency} onValueChange={(value: any) => (formCurrency = value)}>
						<SelectTrigger id="currency" />
						<SelectContent>
							<SelectItem value="RON">RON</SelectItem>
							<SelectItem value="EUR">EUR</SelectItem>
							<SelectItem value="USD">USD</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="date">Date *</Label>
				<Input id="date" type="date" bind:value={formDate} required />
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="client">Client</Label>
					<Select value={formClientId} onValueChange={(value) => (formClientId = value)}>
						<SelectTrigger id="client" />
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each clients as client}
								<SelectItem value={client.id}>{client.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="project">Project</Label>
					<Select value={formProjectId} onValueChange={(value) => (formProjectId = value)}>
						<SelectTrigger id="project" />
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each projects as project}
								<SelectItem value={project.id}>{project.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="category">Category</Label>
					<Input id="category" bind:value={formCategory} />
				</div>

				<div class="space-y-2">
					<Label for="vatRate">VAT Rate (%)</Label>
					<Input id="vatRate" type="number" step="0.01" bind:value={formVatRate} />
				</div>
			</div>

			{#if formError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{formError}</p>
				</div>
			{/if}

			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
				<Button onclick={handleSubmit} disabled={formLoading}>
					{formLoading ? 'Saving...' : editingExpenseId ? 'Update' : 'Create'}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>
