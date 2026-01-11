<script lang="ts">
	import { getTransactions, getBankAccounts, matchTransactionToInvoice, unmatchTransactionFromInvoice } from '$lib/remotes/banking.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '$lib/components/ui/dialog';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, Filter, Link2, Unlink, RefreshCw } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const tenantSlug = $derived(page.params.tenant);

	// Filters
	let selectedAccountId = $state<string>('');
	let fromDate = $state<string>('');
	let toDate = $state<string>('');
	let matchedFilter = $state<'all' | 'matched' | 'unmatched'>('all');
	let expenseFilter = $state<'all' | 'expense' | 'income'>('all');

	const accountsQuery = getBankAccounts();
	const accounts = $derived(accountsQuery.current || []);

	const transactionsQuery = getTransactions({
		bankAccountId: selectedAccountId || undefined,
		fromDate: fromDate || undefined,
		toDate: toDate || undefined,
		matched: matchedFilter === 'all' ? undefined : matchedFilter === 'matched',
		isExpense: expenseFilter === 'all' ? undefined : expenseFilter === 'expense'
	});
	const transactions = $derived(transactionsQuery.current || []);

	// Manual matching
	let matchingTransactionId = $state<string | null>(null);
	let selectedInvoiceId = $state<string>('');
	let invoicesQuery = $derived(matchingTransactionId ? getInvoices({}) : null);
	const invoices = $derived(invoicesQuery?.current || []);
	let isMatchingDialogOpen = $state(false);
	let matching = $state(false);

	async function handleMatch(transactionId: string) {
		matchingTransactionId = transactionId;
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

	async function handleUnmatch(transactionId: string) {
		if (!confirm('Are you sure you want to unmatch this transaction from the invoice?')) {
			return;
		}

		try {
			await unmatchTransactionFromInvoice(transactionId).updates(transactionsQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to unmatch transaction');
		}
	}

	function getStatusVariant(matched: boolean) {
		return matched ? 'default' : 'secondary';
	}

	function formatCurrency(amount: number, currency: string): string {
		return formatAmount(amount, currency as Currency);
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
			<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
				<div class="space-y-2">
					<Label for="account">Bank Account</Label>
					<Select value={selectedAccountId} onValueChange={(value: any) => (selectedAccountId = value)}>
						<SelectTrigger id="account" />
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
					<Select value={matchedFilter} onValueChange={(value: any) => (matchedFilter = value as any)}>
						<SelectTrigger id="matched" />
						<SelectContent>
							<SelectItem value="all">All</SelectItem>
							<SelectItem value="matched">Matched</SelectItem>
							<SelectItem value="unmatched">Unmatched</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div class="space-y-2">
					<Label for="expense">Type</Label>
					<Select value={expenseFilter} onValueChange={(value: any) => (expenseFilter = value as any)}>
						<SelectTrigger id="expense" />
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
			<div class="space-y-4">
				{#each transactions as transaction}
					<div class="flex items-center justify-between rounded-lg border p-4">
						<div class="flex-1">
							<div class="flex items-center gap-3">
								<div>
									<p class="font-semibold">
										{transaction.description || transaction.reference || 'No description'}
									</p>
									<p class="text-sm text-muted-foreground">
										{new Date(transaction.date).toLocaleDateString()} • {transaction.counterpartName || transaction.counterpartIban || 'Unknown'}
									</p>
								</div>
								<Badge variant={getStatusVariant(!!transaction.matchedInvoiceId)}>
									{transaction.matchedInvoiceId ? 'Matched' : 'Unmatched'}
								</Badge>
								{#if transaction.isExpense}
									<Badge variant="destructive">Expense</Badge>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-4">
							<div class="text-right">
								<p class="font-semibold {transaction.amount < 0 ? 'text-red-600' : 'text-green-600'}">
									{transaction.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(transaction.amount), transaction.currency)}
								</p>
							</div>
							<div class="flex items-center gap-2">
								{#if transaction.matchedInvoiceId}
									<Button
										variant="outline"
										size="sm"
										onclick={() => goto(`/${tenantSlug}/invoices/${transaction.matchedInvoiceId}`)}
									>
										View Invoice
									</Button>
									<Button variant="outline" size="sm" onclick={() => handleUnmatch(transaction.id)}>
										<Unlink class="h-4 w-4" />
									</Button>
								{:else if !transaction.isExpense}
									<Button variant="outline" size="sm" onclick={() => handleMatch(transaction.id)}>
										<Link2 class="h-4 w-4" />
										Match
									</Button>
								{/if}
							</div>
						</div>
					</div>
				{:else}
					<p class="text-center text-muted-foreground py-8">No transactions found</p>
				{/each}
			</div>
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
				<Select value={selectedInvoiceId} onValueChange={(value: any) => (selectedInvoiceId = value)}>
					<SelectTrigger id="invoice" />
					<SelectContent>
						<SelectItem value="">Select an invoice...</SelectItem>
						{#each invoices as invoice}
							<SelectItem value={invoice.id}>
								{invoice.invoiceNumber} - {formatCurrency(invoice.totalAmount || 0, invoice.currency)}
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
