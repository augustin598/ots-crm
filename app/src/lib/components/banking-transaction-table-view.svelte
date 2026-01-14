<script lang="ts">
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import type { BankTransaction } from '$lib/server/db/schema';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	// Extended transaction type with expense userId, supplier, and client
	type TransactionWithExpenseUser = BankTransaction & {
		expenseUserId?: string | null;
		expenseSupplierId?: string | null;
		supplierName?: string | null;
		expenseClientId?: string | null;
		clientName?: string | null;
		invoiceClientId?: string | null;
	};

	type Props = {
		transactions: TransactionWithExpenseUser[];
		accountMap: Map<string, string>;
		userMap: Map<string, string>; // userId -> userName
		ibanToUserMap: Map<string, string>; // iban -> userId
		clientMap?: Map<string, string>; // clientId -> clientName (optional, for invoice clients)
		tenantSlug: string;
		sortBy?: string | null;
		sortDir?: 'asc' | 'desc' | null;
		onSortChange: (sortBy: string, sortDir: 'asc' | 'desc') => void;
		onTransactionClick: (transaction: TransactionWithExpenseUser) => void;
		onViewExpense: (transaction: TransactionWithExpenseUser) => void;
		onCreateExpense: (transaction: TransactionWithExpenseUser) => void;
		onLinkToExpense: (transaction: TransactionWithExpenseUser) => void;
		onMatchInvoice: (transaction: TransactionWithExpenseUser) => void;
		onUnmatchInvoice: (transaction: TransactionWithExpenseUser) => void;
	};

	let {
		transactions,
		accountMap,
		userMap,
		ibanToUserMap,
		clientMap = new Map(),
		tenantSlug,
		sortBy = null,
		sortDir = 'asc',
		onSortChange,
		onTransactionClick,
		onViewExpense,
		onCreateExpense,
		onLinkToExpense,
		onMatchInvoice,
		onUnmatchInvoice
	}: Props = $props();

	function handleSort(column: string) {
		const newSortDir = sortBy === column && sortDir === 'asc' ? 'desc' : 'asc';
		onSortChange(column, newSortDir);
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO');
	}

	function formatCurrency(amount: number, currency: string): string {
		return formatAmount(amount, currency as Currency);
	}

	function getSortIcon(column: string) {
		if (sortBy !== column) return '';
		return sortDir === 'asc' ? '↑' : '↓';
	}

	function getDisplayName(transaction: TransactionWithExpenseUser): string | null {
		// Priority 1: Show user name if transaction is linked to a user
		let userId: string | null = null;
		if (transaction.expenseUserId) {
			userId = transaction.expenseUserId;
		} else if (transaction.counterpartIban) {
			// Normalize IBAN (remove spaces, uppercase)
			const normalizedIban = transaction.counterpartIban.replace(/\s/g, '').toUpperCase();
			userId = ibanToUserMap.get(normalizedIban) || null;
		}

		if (userId) {
			return userMap.get(userId) || userId.substring(0, 8);
		}

		// Priority 2: For expenses (outgoing/negative), show supplier name
		if (transaction.amount < 0 && transaction.supplierName) {
			return transaction.supplierName;
		}

		// Priority 3: For income (incoming/positive), show client name
		if (transaction.amount > 0) {
			// Prefer invoice client if matched, otherwise expense client
			if (transaction.invoiceClientId) {
				return clientMap.get(transaction.invoiceClientId) || transaction.clientName || null;
			}
			if (transaction.clientName) {
				return transaction.clientName;
			}
		}

		return null;
	}
</script>

<div class="rounded-md border overflow-x-auto">
	<Table>
		<TableHeader>
			<TableRow>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('date')}
					>
						Date
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'date'}
							<span>{getSortIcon('date')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead class="w-[300px]">
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('description')}
					>
						Description
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'description'}
							<span>{getSortIcon('description')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead>Counterpart</TableHead>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('amount')}
					>
						Amount
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'amount'}
							<span>{getSortIcon('amount')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead>Account</TableHead>
				<TableHead>Status</TableHead>
				<TableHead>User</TableHead>
				<TableHead class="w-[50px]"></TableHead>
			</TableRow>
		</TableHeader>
		<TableBody>
			{#if transactions.length === 0}
				<TableRow>
					<TableCell colspan={8} class="text-center text-muted-foreground py-8">
						No transactions found
					</TableCell>
				</TableRow>
			{:else}
				{#each transactions as transaction}
					{@const accountName = accountMap.get(transaction.bankAccountId) || 'Unknown'}
					{@const displayName = getDisplayName(transaction)}
					<TableRow class="cursor-pointer hover:bg-accent/50" onclick={() => onTransactionClick(transaction)}>
						<TableCell>{formatDate(transaction.date)}</TableCell>
						<TableCell class="font-medium">
							{transaction.description || transaction.reference || 'No description'}
						</TableCell>
						<TableCell>
							<div class="text-sm">
								<div>{transaction.counterpartName || '-'}</div>
								{#if transaction.counterpartIban}
									<div class="text-muted-foreground text-xs">{transaction.counterpartIban}</div>
								{/if}
							</div>
						</TableCell>
						<TableCell>
							<span class={transaction.amount < 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
								{transaction.amount < 0 ? '-' : '+'}
								{formatCurrency(Math.abs(transaction.amount), transaction.currency)}
							</span>
						</TableCell>
						<TableCell>
							<span class="text-sm">{accountName}</span>
						</TableCell>
						<TableCell>
							{#if transaction.matchedInvoiceId}
								<Badge variant="default">Matched</Badge>
							{:else if transaction.isExpense}
								<Badge variant="destructive">Expense</Badge>
							{:else}
								<Badge variant="secondary">Unmatched</Badge>
							{/if}
						</TableCell>
						<TableCell>
							{#if displayName}
								<span class="text-sm">{displayName}</span>
							{:else}
								<span class="text-muted-foreground text-sm">-</span>
							{/if}
						</TableCell>
						<TableCell onclick={(e) => e.stopPropagation()}>
							<DropdownMenu>
								<DropdownMenuTrigger>
									<Button variant="ghost" size="icon" class="h-8 w-8">
										<MoreVerticalIcon class="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{#if transaction.expenseId}
										<DropdownMenuItem onclick={() => onViewExpense(transaction)}>
											View Expense
										</DropdownMenuItem>
									{:else if transaction.isExpense}
										<DropdownMenuItem onclick={() => onCreateExpense(transaction)}>
											Create Expense
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => onLinkToExpense(transaction)}>
											Link to Existing Expense
										</DropdownMenuItem>
									{/if}
									{#if transaction.matchedInvoiceId}
										<DropdownMenuItem onclick={() => onUnmatchInvoice(transaction)}>
											Unmatch Invoice
										</DropdownMenuItem>
									{:else if !transaction.isExpense}
										<DropdownMenuItem onclick={() => onMatchInvoice(transaction)}>
											Match Invoice
										</DropdownMenuItem>
									{/if}
								</DropdownMenuContent>
							</DropdownMenu>
						</TableCell>
					</TableRow>
				{/each}
			{/if}
		</TableBody>
	</Table>
</div>
