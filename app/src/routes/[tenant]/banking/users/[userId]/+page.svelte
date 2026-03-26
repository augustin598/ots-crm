<script lang="ts">
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getUserTransactions, getUserSpending } from '$lib/remotes/banking.remote';
	import { getUserBankAccounts, createUserBankAccount, updateUserBankAccount, deleteUserBankAccount } from '$lib/remotes/user-bank-accounts.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, Plus, Edit, Trash2, Save, X } from '@lucide/svelte';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogTrigger
	} from '$lib/components/ui/dialog';
	import BankingTransactionTableView from '$lib/components/banking-transaction-table-view.svelte';
	import { getBankAccounts } from '$lib/remotes/banking.remote';

	const tenantSlug = $derived(page.params.tenant as string);
	const userId = $derived(page.params.userId as string);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const user = $derived(users.find((u) => u.id === userId));

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	let fromDate = $state<string>('');
	let toDate = $state<string>('');

	const transactionsQuery = getUserTransactions({
		userId,
		fromDate: fromDate || undefined,
		toDate: toDate || undefined
	});
	const transactions = $derived(transactionsQuery.current || []);

	const spendingQuery = getUserSpending({
		userId,
		fromDate: fromDate || undefined,
		toDate: toDate || undefined
	});
	const spending = $derived(spendingQuery.current || { totalSpending: 0, transactionCount: 0, byCurrency: {} });

	const bankAccountsQuery = getUserBankAccounts({ userId });
	const bankAccounts = $derived(bankAccountsQuery.current || []);

	const accountsQuery = getBankAccounts();
	const accounts = $derived(accountsQuery.current || []);

	// Build maps
	const accountMap = $derived(new Map(accounts.map((acc) => [acc.id, acc.accountName || acc.iban])));
	const userMap = $derived(
		new Map(
			users.map((u) => [
				u.id,
				`${u.firstName} ${u.lastName}`.trim() || u.email
			])
		)
	);
	const clientMap = $derived(new Map(clients.map((c) => [c.id, c.name])));

	// Build IBAN to user map
	const ibanToUserMap = $derived.by(() => {
		const map = new Map<string, string>();
		for (const account of bankAccounts) {
			if (account.iban && account.isActive) {
				const normalizedIban = account.iban.replace(/\s/g, '').toUpperCase();
				map.set(normalizedIban, account.userId);
			}
		}
		return map;
	});

	let sortBy = $state<string | null>(null);
	let sortDir = $state<'asc' | 'desc'>('desc');

	function handleSort(column: string, direction: 'asc' | 'desc') {
		sortBy = column;
		sortDir = direction;
	}

	function handleTransactionClick() {
		// Could open detail
	}

	function handleViewExpense() {
		// Navigate to expenses
	}

	function handleCreateExpense() {
		// Navigate to transactions to create expense
	}

	function handleLinkToExpense() {
		// Navigate to transactions to link expense
	}

	function handleMatchInvoice() {
		// Navigate to transactions
	}

	function handleUnmatchInvoice() {
		// Navigate to transactions
	}

	// Bank account management
	let isAccountDialogOpen = $state(false);
	let editingAccountId = $state<string | null>(null);
	let formIban = $state('');
	let formBankName = $state('');
	let formAccountName = $state('');
	let formCurrency = $state('RON');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	function resetAccountForm() {
		formIban = '';
		formBankName = '';
		formAccountName = '';
		formCurrency = 'RON';
		formError = null;
		editingAccountId = null;
	}

	function openCreateAccountDialog() {
		resetAccountForm();
		isAccountDialogOpen = true;
	}

	function openEditAccountDialog(account: any) {
		editingAccountId = account.id;
		formIban = account.iban;
		formBankName = account.bankName || '';
		formAccountName = account.accountName || '';
		formCurrency = account.currency || 'RON';
		formError = null;
		isAccountDialogOpen = true;
	}

	async function handleSaveAccount() {
		if (!formIban) {
			formError = 'IBAN is required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			if (editingAccountId) {
				await updateUserBankAccount({
					accountId: editingAccountId,
					iban: formIban,
					bankName: formBankName || undefined,
					accountName: formAccountName || undefined,
					currency: formCurrency || undefined
				}).updates(bankAccountsQuery);
			} else {
				await createUserBankAccount({
					userId,
					iban: formIban,
					bankName: formBankName || undefined,
					accountName: formAccountName || undefined,
					currency: formCurrency || undefined
				}).updates(bankAccountsQuery);
			}
			isAccountDialogOpen = false;
			resetAccountForm();
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to save bank account';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteAccount(accountId: string) {
		if (!confirm('Are you sure you want to delete this bank account?')) {
			return;
		}

		try {
			await deleteUserBankAccount(accountId).updates(bankAccountsQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete bank account');
		}
	}
</script>

<svelte:head>
	<title>{user ? `${user.firstName} ${user.lastName}` : 'User'} - Spending</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Button variant="ghost" size="icon" onclick={() => goto(`/${tenantSlug}/banking/users`)}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-3xl font-bold">
					{user ? `${user.firstName} ${user.lastName}` : 'Loading...'}
				</h1>
				<p class="text-muted-foreground">User spending and transactions</p>
			</div>
		</div>
	</div>

	{#if user}
		<div class="grid gap-6 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Spending Summary</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					<div>
						<p class="text-sm text-muted-foreground">Total Spending</p>
						<p class="text-3xl font-bold text-red-600">
							-{formatAmount(spending.totalSpending, 'RON')}
						</p>
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Transactions</p>
						<p class="text-xl font-semibold">{spending.transactionCount}</p>
					</div>
					{#if Object.keys(spending.byCurrency).length > 0}
						<div class="pt-3 border-t">
							<p class="text-sm font-medium mb-2">By Currency:</p>
							<div class="space-y-2">
								{#each Object.entries(spending.byCurrency) as [currency, data]}
									<div class="flex justify-between">
										<span>{currency}:</span>
										<span class="font-medium">-{formatAmount(data.total, currency as Currency)}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Bank Accounts</CardTitle>
					<CardDescription>Manage user's bank accounts for transaction matching</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<Button variant="outline" class="w-full" onclick={openCreateAccountDialog}>
						<Plus class="mr-2 h-4 w-4" />
						Add Bank Account
					</Button>
					{#if bankAccounts.length === 0}
						<p class="text-center text-muted-foreground py-4">No bank accounts added</p>
					{:else}
						<div class="space-y-2">
							{#each bankAccounts as account}
								<div class="flex items-center justify-between rounded-lg border p-3">
									<div>
										<p class="font-medium">{account.accountName || 'Unnamed Account'}</p>
										<p class="text-sm text-muted-foreground">{account.iban}</p>
										{#if account.bankName}
											<p class="text-xs text-muted-foreground">{account.bankName}</p>
										{/if}
									</div>
									<div class="flex gap-2">
										<Button
											variant="ghost"
											size="icon"
											onclick={() => openEditAccountDialog(account)}
										>
											<Edit class="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onclick={() => handleDeleteAccount(account.id)}
										>
											<Trash2 class="h-4 w-4" />
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Date Range Filter</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="fromDate">From Date</Label>
						<Input id="fromDate" type="date" bind:value={fromDate} />
					</div>
					<div class="space-y-2">
						<Label for="toDate">To Date</Label>
						<Input id="toDate" type="date" bind:value={toDate} />
					</div>
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Transactions ({transactions.length})</CardTitle>
				<CardDescription>Transactions matched to this user by IBAN</CardDescription>
			</CardHeader>
			<CardContent>
				<BankingTransactionTableView
					transactions={transactions}
					accountMap={accountMap}
					userMap={userMap}
					ibanToUserMap={ibanToUserMap}
					clientMap={clientMap}
					tenantSlug={tenantSlug}
					sortBy={sortBy}
					sortDir={sortDir}
					onSortChange={handleSort}
					onTransactionClick={handleTransactionClick}
					onViewExpense={handleViewExpense}
					onCreateExpense={handleCreateExpense}
					onLinkToExpense={handleLinkToExpense}
					onMatchInvoice={handleMatchInvoice}
					onUnmatchInvoice={handleUnmatchInvoice}
				/>
			</CardContent>
		</Card>
	{/if}
</div>

<Dialog bind:open={isAccountDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{editingAccountId ? 'Edit Bank Account' : 'Add Bank Account'}</DialogTitle>
			<DialogDescription>
				{editingAccountId ? 'Update bank account details' : 'Add a bank account for transaction matching'}
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<div class="space-y-2">
				<Label for="iban">IBAN *</Label>
				<Input id="iban" bind:value={formIban} placeholder="RO49 AAAA 1B31 0075 9384 0000" required />
			</div>
			<div class="space-y-2">
				<Label for="bankName">Bank Name</Label>
				<Input id="bankName" bind:value={formBankName} placeholder="Bank Name" />
			</div>
			<div class="space-y-2">
				<Label for="accountName">Account Name</Label>
				<Input id="accountName" bind:value={formAccountName} placeholder="Account nickname" />
			</div>
			<div class="space-y-2">
				<Label for="currency">Currency</Label>
				<Input id="currency" bind:value={formCurrency} placeholder="RON" />
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{formError}</p>
				</div>
			{/if}
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={() => (isAccountDialogOpen = false)}>Cancel</Button>
			<Button onclick={handleSaveAccount} disabled={formLoading}>
				{formLoading ? 'Saving...' : editingAccountId ? 'Update' : 'Add'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
