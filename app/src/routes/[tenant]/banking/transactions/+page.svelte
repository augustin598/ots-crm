<script lang="ts">
	import {
		getTransactions,
		getBankAccounts,
		matchTransactionToInvoice,
		unmatchTransactionFromInvoice
	} from '$lib/remotes/banking.remote';
	import { getUserBankAccounts } from '$lib/remotes/user-bank-accounts.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, Filter, Link2, Unlink } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BankingTransactionTableView from '$lib/components/banking-transaction-table-view.svelte';
	import type { BankTransaction } from '$lib/server/db/schema';

	const tenantSlug = $derived(page.params.tenant);

	// Filters
	let selectedAccountId = $state<string>('');
	let fromDate = $state<string>('');
	let toDate = $state<string>('');
	let matchedFilter = $state<'all' | 'matched' | 'unmatched'>('all');
	let expenseFilter = $state<'all' | 'expense' | 'income'>('all');
	let sortBy = $state<string | null>(null);
	let sortDir = $state<'asc' | 'desc'>('desc');

	const accountsQuery = $derived(getBankAccounts());
	const accounts = $derived(accountsQuery.current || []);

	const usersQuery = $derived(getTenantUsers());
	const users = $derived(usersQuery.current || []);

	const clientsQuery = $derived(getClients());
	const clients = $derived(clientsQuery.current || []);

	const userBankAccountsQuery = $derived(getUserBankAccounts({}));
	const userBankAccounts = $derived(userBankAccountsQuery.current || []);

	// Build maps
	const accountMap = $derived(
		new Map(accounts.map((acc) => [acc.id, acc.accountName || acc.iban]))
	);
	const userMap = $derived(
		new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]))
	);
	const clientMap = $derived(new Map(clients.map((c) => [c.id, c.name])));

	// Build IBAN to user map for matching (normalized IBANs)
	const ibanToUserMap = $derived.by(() => {
		const map = new Map<string, string>();
		for (const account of userBankAccounts) {
			if (account.iban && account.isActive) {
				const normalizedIban = account.iban.replace(/\s/g, '').toUpperCase();
				map.set(normalizedIban, account.userId);
			}
		}
		return map;
	});

	const transactionsQuery = $derived(
		getTransactions({
			bankAccountId: selectedAccountId || undefined,
			fromDate: fromDate || undefined,
			toDate: toDate || undefined,
			matched: matchedFilter === 'all' ? undefined : matchedFilter === 'matched',
			isExpense: expenseFilter === 'all' ? undefined : expenseFilter === 'expense'
		})
	);
	const allTransactions = $derived(transactionsQuery.current || []);

	// Sort transactions
	const transactions = $derived(
		allTransactions.toSorted((a, b) => {
			let aVal: any;
			let bVal: any;

			switch (sortBy) {
				case 'date':
					aVal = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
					bVal = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
					break;
				case 'description':
					aVal = (a.description || a.reference || '').toLowerCase();
					bVal = (b.description || b.reference || '').toLowerCase();
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
		})
	);

	// Manual matching
	let matchingTransactionId = $state<string | null>(null);
	let selectedInvoiceId = $state<string>('');
	let invoicesQuery = $derived(matchingTransactionId ? getInvoices({}) : null);
	const invoices = $derived(invoicesQuery?.current || []);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);
	let isMatchingDialogOpen = $state(false);
	let matching = $state(false);

	function handleSort(column: string, direction: 'asc' | 'desc') {
		sortBy = column;
		sortDir = direction;
	}

	function handleTransactionClick(transaction: BankTransaction) {
		// Could open a detail dialog or navigate
	}

	function handleViewExpense(transaction: BankTransaction) {
		if (transaction.expenseId) {
			goto(`/${tenantSlug}/banking/expenses`);
		}
	}

	function handleMatchInvoice(transaction: BankTransaction) {
		matchingTransactionId = transaction.id;
		isMatchingDialogOpen = true;
		selectedInvoiceId = '';
	}

	async function handleConfirmMatch() {
		if (!matchingTransactionId || !selectedInvoiceId) return;

		matching = true;
		try {
			await matchTransactionToInvoice({
				transactionId: matchingTransactionId,
				invoiceId: selectedInvoiceId,
				matchingMethod: 'manual'
			}).updates(transactionsQuery);
			isMatchingDialogOpen = false;
			matchingTransactionId = null;
			selectedInvoiceId = '';
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to match transaction');
		} finally {
			matching = false;
		}
	}

	async function handleUnmatchInvoice(transaction: BankTransaction) {
		if (!confirm('Are you sure you want to unmatch this transaction from the invoice?')) {
			return;
		}

		try {
			await unmatchTransactionFromInvoice(transaction.id).updates(transactionsQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to unmatch transaction');
		}
	}
</script>

<svelte:head>
	<title>Bank Transactions - Banking</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Button variant="ghost" size="icon" onclick={() => goto(`/${tenantSlug}/banking`)}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-3xl font-bold">Bank Transactions</h1>
				<p class="text-muted-foreground">View and manage bank transactions</p>
			</div>
		</div>
	</div>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Filter class="h-5 w-5" />
				Filters
			</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-5">
				<div class="space-y-2">
					<Label for="account">Bank Account</Label>
					<Select
						type="single"
						value={selectedAccountId}
						onValueChange={(value: any) => (selectedAccountId = value)}
					>
						<SelectTrigger id="account">
							{selectedAccountId ? accountMap.get(selectedAccountId) : 'All Accounts'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">All Accounts</SelectItem>
							{#each accounts as account}
								<SelectItem value={account.id}>{account.accountName || account.iban}</SelectItem>
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
					<Label for="matched">Match Status</Label>
					<Select
						type="single"
						value={matchedFilter}
						onValueChange={(value: any) => (matchedFilter = value as any)}
					>
						<SelectTrigger id="matched">
							{matchedFilter === 'all' ? 'All' : matchedFilter === 'matched' ? 'Matched' : 'Unmatched'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All</SelectItem>
							<SelectItem value="matched">Matched</SelectItem>
							<SelectItem value="unmatched">Unmatched</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="expense">Type</Label>
					<Select
						type="single"
						value={expenseFilter}
						onValueChange={(value: any) => (expenseFilter = value as any)}
					>
						<SelectTrigger id="expense">
							{expenseFilter === 'all' ? 'All' : expenseFilter === 'income' ? 'Income' : 'Expense'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All</SelectItem>
							<SelectItem value="income">Income</SelectItem>
							<SelectItem value="expense">Expense</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Transactions ({transactions.length})</CardTitle>
		</CardHeader>
		<CardContent>
			<BankingTransactionTableView
				{transactions}
				{accountMap}
				{userMap}
				{ibanToUserMap}
				{clientMap}
				{tenantSlug}
				{sortBy}
				{sortDir}
				onSortChange={handleSort}
				onTransactionClick={handleTransactionClick}
				onViewExpense={handleViewExpense}
				onMatchInvoice={handleMatchInvoice}
				onUnmatchInvoice={handleUnmatchInvoice}
			/>
		</CardContent>
	</Card>
</div>

<Dialog bind:open={isMatchingDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Match Transaction to Invoice</DialogTitle>
			<DialogDescription>Select an invoice to match this transaction to</DialogDescription>
		</DialogHeader>
		<div class="space-y-4">
			<div class="space-y-2">
				<Label for="invoice">Invoice</Label>
				<Select
					type="single"
					value={selectedInvoiceId}
					onValueChange={(value: any) => (selectedInvoiceId = value)}
				>
					<SelectTrigger id="invoice" />
					<SelectContent>
						<SelectItem value="">Select an invoice...</SelectItem>
						{#each invoices as invoice}
							<SelectItem value={invoice.id}>
								{formatInvoiceNumberDisplay(invoice, invoiceSettings)} - {formatAmount(invoice.totalAmount || 0, invoice.currency)}
							</SelectItem>
						{/each}
					</SelectContent>
				</Select>
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={() => (isMatchingDialogOpen = false)}>Cancel</Button>
				<Button onclick={handleConfirmMatch} disabled={!selectedInvoiceId || matching}>
					{matching ? 'Matching...' : 'Match'}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>
