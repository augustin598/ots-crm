<script lang="ts">
	import { getExpenses, createExpense, updateExpense, deleteExpense, uploadExpenseInvoice, getExpenseInvoiceUrl, linkExpenseToUser, getTransactions, findSimilarExpenses, linkSimilarExpensesToSupplier, findSimilarExpensesForUser, linkSimilarExpensesToUser } from '$lib/remotes/banking.remote';
	import { getSuppliers, createSupplier } from '$lib/remotes/suppliers.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, Plus, Filter, Upload } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BankingExpenseTableView from '$lib/components/banking-expense-table-view.svelte';
	import type { Expense } from '$lib/server/db/schema';

	const tenantSlug = $derived(page.params.tenant || '');

	// Filters
	let selectedSupplierId = $state<string>('');
	let selectedClientId = $state<string>('');
	let selectedProjectId = $state<string>('');
	let fromDate = $state<string>('');
	let toDate = $state<string>('');
	let categoryFilter = $state<string>('');
	let sortBy = $state<string | null>(null);
	let sortDir = $state<'asc' | 'desc'>('desc');

	const suppliersQuery = $derived(getSuppliers());
	const suppliers = $derived(suppliersQuery.current || []);

	const clientsQuery = $derived(getClients());
	const clients = $derived(clientsQuery.current || []);

	const projectsQuery = $derived(getProjects(undefined));
	const projects = $derived(projectsQuery.current || []);

	const usersQuery = $derived(getTenantUsers());
	const users = $derived(usersQuery.current || []);

	// Get all transactions for IBAN lookup when creating suppliers
	const allTransactionsQuery = $derived(getTransactions({}));
	const allTransactions = $derived(allTransactionsQuery.current || []);

	const expensesQuery = $derived(getExpenses({
		supplierId: selectedSupplierId || undefined,
		clientId: selectedClientId || undefined,
		projectId: selectedProjectId || undefined,
		fromDate: fromDate || undefined,
		toDate: toDate || undefined,
		category: categoryFilter || undefined
	}));
	const allExpenses = $derived(expensesQuery.current || []);

	// Sort expenses
	const expenses = $derived(allExpenses.toSorted((a, b) => {
				let aVal: any;
				let bVal: any;

				switch (sortBy) {
					case 'date':
						aVal = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
						bVal = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
						break;
					case 'description':
						aVal = (a.description || '').toLowerCase();
						bVal = (b.description || '').toLowerCase();
						break;
					case 'amount':
						aVal = a.amount;
						bVal = b.amount;
						break;
					default:
						return 0;
				}

				if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
				if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
				return 0;
			}));

	// Build maps
	const supplierMap = $derived(new Map(suppliers.map((s) => [s.id, s.name])));

	// Dialog state
	let isDialogOpen = $state(false);
	let editingExpenseId = $state<string | null>(null);

	// Form state
	let formDescription = $state('');
	let formAmount = $state('');
	let formCurrency = $state<Currency>('RON');
	let formDate = $state(new Date().toISOString().split('T')[0]);
	let formSupplierId = $state<string>('');
	let formClientId = $state<string>('');
	let formProjectId = $state<string>('');
	let formCategory = $state('');
	let formVatRate = $state('');
	let formInvoiceFile = $state<File | null>(null);
	let formUserId = $state<string>('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	// Create supplier dialog state
	let isCreateSupplierDialogOpen = $state(false);
	let newSupplierName = $state('');
	let newSupplierIban = $state('');
	let newSupplierCui = $state('');
	let creatingSupplier = $state(false);
	let currentExpenseForSupplier = $state<Expense | null>(null);

	// Link similar expenses dialog state
	let isLinkSimilarDialogOpen = $state(false);
	let similarExpensesCount = $state(0);
	let pendingSupplierId = $state<string>('');
	let pendingExpenseId = $state<string>('');
	let linkingSimilar = $state(false);

	// Link user IBAN dialog state
	let isLinkUserIbanDialogOpen = $state(false);
	let pendingUserId = $state<string>('');
	let pendingUserExpenseId = $state<string>('');
	let userIban = $state<string>('');
	let linkingUserIban = $state(false);

	// Link similar expenses to user dialog state
	let isLinkSimilarUserDialogOpen = $state(false);
	let similarUserExpensesCount = $state(0);
	let pendingUserIdForSimilar = $state<string>('');
	let pendingUserExpenseIdForSimilar = $state<string>('');
	let pendingUserIbanForSimilar = $state<string>('');
	let linkingSimilarUser = $state(false);

	function resetForm() {
		formDescription = '';
		formAmount = '';
		formCurrency = 'RON';
		formDate = new Date().toISOString().split('T')[0];
		formSupplierId = '';
		formClientId = '';
		formProjectId = '';
		formCategory = '';
		formVatRate = '';
		formInvoiceFile = null;
		formUserId = '';
		formError = null;
		editingExpenseId = null;
	}

	function openCreateDialog() {
		resetForm();
		currentExpenseForSupplier = null;
		isDialogOpen = true;
	}

	function openEditDialog(expense: Expense) {
		editingExpenseId = expense.id;
		currentExpenseForSupplier = expense;
		formDescription = expense.description;
		formAmount = ((expense.amount || 0) / 100).toString();
		formCurrency = (expense.currency || 'RON') as Currency;
		formDate = new Date(expense.date).toISOString().split('T')[0];
		formSupplierId = expense.supplierId || '';
		formClientId = expense.clientId || '';
		formProjectId = expense.projectId || '';
		formCategory = expense.category || '';
		formVatRate = expense.vatRate ? ((expense.vatRate / 100).toString()) : '';
		formInvoiceFile = null;
		formUserId = '';
		formError = null;
		isDialogOpen = true;
	}

	async function handleCreateSupplier() {
		if (!newSupplierName) {
			formError = 'Supplier name is required';
			return;
		}

		creatingSupplier = true;
		formError = null;

		try {
			const result = await createSupplier({
				name: newSupplierName,
				iban: newSupplierIban || undefined,
				cui: newSupplierCui || undefined
			}).updates(suppliersQuery);

			if (result.supplierId) {
				formSupplierId = result.supplierId;
			}
			newSupplierName = '';
			newSupplierIban = '';
			newSupplierCui = '';
			isCreateSupplierDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create supplier';
		} finally {
			creatingSupplier = false;
		}
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
				// Check if supplier is being linked and if there are similar expenses
				const previousSupplierId = (currentExpenseForSupplier && currentExpenseForSupplier.supplierId) || '';
				const newSupplierId = formSupplierId || '';
				const isLinkingSupplier = newSupplierId && newSupplierId !== previousSupplierId;

				await updateExpense({
					expenseId: editingExpenseId,
					description: formDescription,
					amount: parseFloat(formAmount),
					currency: formCurrency,
					date: formDate,
					supplierId: formSupplierId || undefined,
					clientId: formClientId || undefined,
					projectId: formProjectId || undefined,
					category: formCategory || undefined,
					vatRate: formVatRate ? parseFloat(formVatRate) : undefined
				}).updates(expensesQuery);

				// If supplier was linked, check for similar expenses
				if (isLinkingSupplier && editingExpenseId) {
					const similarExpenses = await findSimilarExpenses({ expenseId: editingExpenseId });
					if (similarExpenses.length > 0) {
						similarExpensesCount = similarExpenses.length;
						pendingSupplierId = newSupplierId;
						pendingExpenseId = editingExpenseId;
						isLinkSimilarDialogOpen = true;
						// Don't close the main dialog yet - wait for user decision
						formLoading = false;
						return;
					}
				}

				// Upload invoice if provided
				if (formInvoiceFile) {
					await uploadExpenseInvoice({
						expenseId: editingExpenseId,
						file: formInvoiceFile
					});
				}

				// Link to user if provided
				if (formUserId) {
					try {
						const linkResult = await linkExpenseToUser({
							expenseId: editingExpenseId,
							userId: formUserId
						});

						// If IBAN is needed, show dialog asking for IBAN
						if (linkResult.needsIban) {
							pendingUserId = formUserId;
							pendingUserExpenseId = editingExpenseId;
							userIban = '';
							isLinkUserIbanDialogOpen = true;
							// Don't close the main dialog yet - wait for user decision
							formLoading = false;
							return;
						}

						// If linking succeeded, check for similar expenses
						if (linkResult.success) {
							const similarExpenses = await findSimilarExpensesForUser({ expenseId: editingExpenseId });
							if (similarExpenses.length > 0) {
								similarUserExpensesCount = similarExpenses.length;
								pendingUserIdForSimilar = formUserId;
								pendingUserExpenseIdForSimilar = editingExpenseId;
								pendingUserIbanForSimilar = userIban || '';
								isLinkSimilarUserDialogOpen = true;
								// Don't close the main dialog yet - wait for user decision
								formLoading = false;
								return;
							}
						}
					} catch (e) {
						// Log error but don't fail the expense update
						console.error('Failed to link expense to user:', e);
					}
				}
			} else {
				const result = await createExpense({
					description: formDescription,
					amount: parseFloat(formAmount),
					currency: formCurrency,
					date: formDate,
					supplierId: formSupplierId || undefined,
					clientId: formClientId || undefined,
					projectId: formProjectId || undefined,
					category: formCategory || undefined,
					vatRate: formVatRate ? parseFloat(formVatRate) : undefined
				}).updates(expensesQuery);

				// Upload invoice if provided
				if (formInvoiceFile && result.expenseId) {
					await uploadExpenseInvoice({
						expenseId: result.expenseId,
						file: formInvoiceFile
					});
				}

				// Link to user if provided
				if (formUserId && result.expenseId) {
					try {
						const linkResult = await linkExpenseToUser({
							expenseId: result.expenseId,
							userId: formUserId
						});

						// If IBAN is needed, show dialog asking for IBAN
						if (linkResult.needsIban) {
							pendingUserId = formUserId;
							pendingUserExpenseId = result.expenseId;
							userIban = '';
							isLinkUserIbanDialogOpen = true;
							// Don't close the main dialog yet - wait for user decision
							formLoading = false;
							return;
						}

						// If linking succeeded, check for similar expenses
						if (linkResult.success) {
							const similarExpenses = await findSimilarExpensesForUser({ expenseId: result.expenseId });
							if (similarExpenses.length > 0) {
								similarUserExpensesCount = similarExpenses.length;
								pendingUserIdForSimilar = formUserId;
								pendingUserExpenseIdForSimilar = result.expenseId;
								pendingUserIbanForSimilar = userIban || '';
								isLinkSimilarUserDialogOpen = true;
								// Don't close the main dialog yet - wait for user decision
								formLoading = false;
								return;
							}
						}
					} catch (e) {
						// Log error but don't fail the expense creation
						console.error('Failed to link expense to user:', e);
					}
				}
			}
			isDialogOpen = false;
			resetForm();
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to save expense';
		} finally {
			formLoading = false;
		}
	}

	async function handleLinkSimilarExpenses() {
		if (!pendingSupplierId || !pendingExpenseId) return;

		linkingSimilar = true;
		try {
			await linkSimilarExpensesToSupplier({
				expenseId: pendingExpenseId,
				supplierId: pendingSupplierId
			}).updates(expensesQuery);

			isLinkSimilarDialogOpen = false;
			isDialogOpen = false;
			resetForm();
			pendingSupplierId = '';
			pendingExpenseId = '';
			similarExpensesCount = 0;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to link similar expenses';
		} finally {
			linkingSimilar = false;
		}
	}

	function handleSkipLinkSimilar() {
		isLinkSimilarDialogOpen = false;
		isDialogOpen = false;
		resetForm();
		pendingSupplierId = '';
		pendingExpenseId = '';
		similarExpensesCount = 0;
	}

	async function handleLinkUserIban() {
		if (!userIban || !pendingUserId || !pendingUserExpenseId) return;

		linkingUserIban = true;
		formError = null;
		try {
			const linkResult = await linkExpenseToUser({
				expenseId: pendingUserExpenseId,
				userId: pendingUserId,
				iban: userIban
			});

			if (!linkResult.success) {
				formError = 'Failed to link expense to user';
				linkingUserIban = false;
				return;
			}

			// Check for similar expenses
			const similarExpenses = await findSimilarExpensesForUser({ expenseId: pendingUserExpenseId });
			if (similarExpenses.length > 0) {
				similarUserExpensesCount = similarExpenses.length;
				pendingUserIdForSimilar = pendingUserId;
				pendingUserExpenseIdForSimilar = pendingUserExpenseId;
				pendingUserIbanForSimilar = userIban;
				isLinkUserIbanDialogOpen = false;
				isLinkSimilarUserDialogOpen = true;
			} else {
				isLinkUserIbanDialogOpen = false;
				isDialogOpen = false;
				resetForm();
				pendingUserId = '';
				pendingUserExpenseId = '';
				userIban = '';
			}
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to link expense to user';
		} finally {
			linkingUserIban = false;
		}
	}

	function handleSkipLinkUserIban() {
		isLinkUserIbanDialogOpen = false;
		isDialogOpen = false;
		resetForm();
		pendingUserId = '';
		pendingUserExpenseId = '';
		userIban = '';
	}

	async function handleLinkSimilarUserExpenses() {
		if (!pendingUserIdForSimilar || !pendingUserExpenseIdForSimilar) return;

		linkingSimilarUser = true;
		formError = null;
		try {
			await linkSimilarExpensesToUser({
				expenseId: pendingUserExpenseIdForSimilar,
				userId: pendingUserIdForSimilar,
				iban: pendingUserIbanForSimilar || undefined
			}).updates(expensesQuery);

			isLinkSimilarUserDialogOpen = false;
			isDialogOpen = false;
			resetForm();
			pendingUserIdForSimilar = '';
			pendingUserExpenseIdForSimilar = '';
			pendingUserIbanForSimilar = '';
			similarUserExpensesCount = 0;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to link similar expenses to user';
		} finally {
			linkingSimilarUser = false;
		}
	}

	function handleSkipLinkSimilarUser() {
		isLinkSimilarUserDialogOpen = false;
		isDialogOpen = false;
		resetForm();
		pendingUserIdForSimilar = '';
		pendingUserExpenseIdForSimilar = '';
		pendingUserIbanForSimilar = '';
		similarUserExpensesCount = 0;
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

	async function handleViewInvoice(expense: Expense) {
		try {
			const result = await getExpenseInvoiceUrl(expense.id);
			window.open(result.url, '_blank');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to load invoice');
		}
	}

	function handleExpenseClick(expense: Expense) {
		// Could open detail view
	}

	function handleSort(column: string, direction: 'asc' | 'desc') {
		sortBy = column;
		sortDir = direction;
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
			<div class="grid grid-cols-1 md:grid-cols-6 gap-4">
				<div class="space-y-2">
					<Label for="supplier">Supplier</Label>
					<Select type="single" value={selectedSupplierId} onValueChange={(value) => (selectedSupplierId = value)}>
						<SelectTrigger id="supplier">
							{selectedSupplierId ? suppliers.find((s) => s.id === selectedSupplierId)?.name : 'All Suppliers'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">All Suppliers</SelectItem>
							{#each suppliers as supplier}
								<SelectItem value={supplier.id}>{supplier.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="client">Client</Label>
					<Select type="single" value={selectedClientId} onValueChange={(value) => (selectedClientId = value)}>
						<SelectTrigger id="client">
							{selectedClientId ? clients.find((c) => c.id === selectedClientId)?.name : 'All Clients'}
						</SelectTrigger>
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
					<Select type="single" value={selectedProjectId} onValueChange={(value) => (selectedProjectId = value)}>
						<SelectTrigger id="project">
							{selectedProjectId ? projects.find((p) => p.id === selectedProjectId)?.name : 'All Projects'}
						</SelectTrigger>
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
			<BankingExpenseTableView
				expenses={expenses}
				supplierMap={supplierMap}
				tenantSlug={tenantSlug}
				sortBy={sortBy}
				sortDir={sortDir}
				onSortChange={handleSort}
				onExpenseClick={handleExpenseClick}
				onEditExpense={openEditDialog}
				onDeleteExpense={handleDelete}
				onViewInvoice={handleViewInvoice}
			/>
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
					<Select type="single" value={formCurrency} onValueChange={(value: any) => (formCurrency = value)}>
						<SelectTrigger id="currency">
							{formCurrency}
						</SelectTrigger>
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
					<div class="flex items-center justify-between">
						<Label for="supplier">Supplier</Label>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => {
								// Pre-fill supplier name from expense description
								newSupplierName = formDescription || '';
								newSupplierIban = '';
								
								// If editing an expense with a bank transaction, get the IBAN from the transaction
								if (editingExpenseId && currentExpenseForSupplier && currentExpenseForSupplier.bankTransactionId) {
									const transaction = allTransactions.find(t => t.id === currentExpenseForSupplier!.bankTransactionId);
									if (transaction?.counterpartIban) {
										newSupplierIban = transaction.counterpartIban;
									}
								}
								
								// If no IBAN found, try to extract from description
								if (!newSupplierIban) {
									const ibanMatch = formDescription.match(/\b[A-Z]{2}\d{2}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{0,30}\b/i);
									if (ibanMatch) {
										newSupplierIban = ibanMatch[0].replace(/\s/g, ' ').trim();
									}
								}
								
								isCreateSupplierDialogOpen = true;
							}}
						>
							<Plus class="h-3 w-3 mr-1" />
							New
						</Button>
					</div>
					<Select type="single" value={formSupplierId} onValueChange={(value) => (formSupplierId = value)}>
						<SelectTrigger id="supplier">
							{formSupplierId ? suppliers.find((s) => s.id === formSupplierId)?.name : 'None'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each suppliers as supplier}
								<SelectItem value={supplier.id}>{supplier.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="client">Client</Label>
					<Select type="single" value={formClientId} onValueChange={(value) => (formClientId = value)}>
						<SelectTrigger id="client">
							{formClientId ? clients.find((c) => c.id === formClientId)?.name : 'None'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each clients as client}
								<SelectItem value={client.id}>{client.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="project">Project</Label>
					<Select type="single" value={formProjectId} onValueChange={(value) => (formProjectId = value)}>
						<SelectTrigger id="project">
							{formProjectId ? projects.find((p) => p.id === formProjectId)?.name : 'None'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each projects as project}
								<SelectItem value={project.id}>{project.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="category">Category</Label>
					<Input id="category" bind:value={formCategory} />
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="user">Link to User</Label>
					<Select type="single" value={formUserId} onValueChange={(value) => (formUserId = value)}>
						<SelectTrigger id="user">
							{formUserId
								? users.find((u) => u.id === formUserId)
									? `${users.find((u) => u.id === formUserId)?.firstName} ${users.find((u) => u.id === formUserId)?.lastName}`.trim()
									: 'Unknown'
								: 'None'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each users as user}
								<SelectItem value={user.id}>
									{user.firstName} {user.lastName} ({user.email})
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
					<p class="text-xs text-muted-foreground">
						If expense is linked to a transaction, user's bank account will be auto-created from transaction IBAN
					</p>
				</div>

				<div class="space-y-2">
					<Label for="vatRate">VAT Rate (%)</Label>
					<Input id="vatRate" type="number" step="0.01" bind:value={formVatRate} />
				</div>
			</div>

			<div class="space-y-2">
				<Label for="invoice">Invoice</Label>
				<Input
					id="invoice"
					type="file"
					accept=".pdf,.jpg,.jpeg,.png"
					onchange={(e) => {
						const file = (e.target as HTMLInputElement).files?.[0];
						if (file) {
							formInvoiceFile = file;
						}
					}}
				/>
				{#if formInvoiceFile}
					<p class="text-sm text-muted-foreground">{formInvoiceFile.name}</p>
				{/if}
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

<Dialog bind:open={isCreateSupplierDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Create New Supplier</DialogTitle>
			<DialogDescription>Create a supplier that will be linked to this expense</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<div class="space-y-2">
				<Label for="newSupplierName">Name *</Label>
				<Input id="newSupplierName" bind:value={newSupplierName} placeholder="Supplier Name" required />
			</div>
			<div class="space-y-2">
				<Label for="newSupplierCui">CUI</Label>
				<Input id="newSupplierCui" bind:value={newSupplierCui} placeholder="Company Registration Number" />
			</div>
			<div class="space-y-2">
				<Label for="newSupplierIban">IBAN</Label>
				<Input id="newSupplierIban" bind:value={newSupplierIban} placeholder="RO49 AAAA 1B31 0075 9384 0000" />
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={() => (isCreateSupplierDialogOpen = false)}>Cancel</Button>
				<Button onclick={handleCreateSupplier} disabled={creatingSupplier || !newSupplierName}>
					{creatingSupplier ? 'Creating...' : 'Create'}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>

<Dialog bind:open={isLinkSimilarDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Link Similar Expenses?</DialogTitle>
			<DialogDescription>
				Found {similarExpensesCount} similar expense{similarExpensesCount !== 1 ? 's' : ''} with the same counterpart or description that are not yet linked to a supplier.
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<p class="text-sm text-muted-foreground">
				Would you like to link all {similarExpensesCount} similar expense{similarExpensesCount !== 1 ? 's' : ''} to the same supplier? This will help with future automatic matching.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={handleSkipLinkSimilar} disabled={linkingSimilar}>
					Skip
				</Button>
				<Button onclick={handleLinkSimilarExpenses} disabled={linkingSimilar}>
				{linkingSimilar ? 'Linking...' : `Link All ${similarExpensesCount} Expense${similarExpensesCount !== 1 ? 's' : ''}`}
			</Button>
		</div>
	</div>
</DialogContent>
</Dialog>

<Dialog bind:open={isLinkUserIbanDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>User IBAN Required</DialogTitle>
			<DialogDescription>
				This expense doesn't have an IBAN from the transaction. Please provide the user's IBAN to link the expense and create the bank account.
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<div class="space-y-2">
				<Label for="userIban">User IBAN *</Label>
				<Input
					id="userIban"
					bind:value={userIban}
					placeholder="RO49 AAAA 1B31 0075 9384 0000"
					required
				/>
				<p class="text-xs text-muted-foreground">
					The IBAN of the bank account that was used for this expense
				</p>
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{formError}</p>
				</div>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={handleSkipLinkUserIban} disabled={linkingUserIban}>
					Cancel
				</Button>
				<Button onclick={handleLinkUserIban} disabled={linkingUserIban || !userIban}>
					{linkingUserIban ? 'Linking...' : 'Link & Create Account'}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>

<Dialog bind:open={isLinkSimilarUserDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Link Similar Expenses to User?</DialogTitle>
			<DialogDescription>
				Found {similarUserExpensesCount} similar expense{similarUserExpensesCount !== 1 ? 's' : ''} with the same counterpart or description.
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<p class="text-sm text-muted-foreground">
				Would you like to link all {similarUserExpensesCount} similar expense{similarUserExpensesCount !== 1 ? 's' : ''} to the same user? This will help with future automatic matching.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={handleSkipLinkSimilarUser} disabled={linkingSimilarUser}>
					Skip
				</Button>
				<Button onclick={handleLinkSimilarUserExpenses} disabled={linkingSimilarUser}>
					{linkingSimilarUser ? 'Linking...' : `Link All ${similarUserExpensesCount} Expense${similarUserExpensesCount !== 1 ? 's' : ''}`}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>
