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
	import FileIcon from '@lucide/svelte/icons/file';
	import type { Expense } from '$lib/server/db/schema';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	type Props = {
		expenses: Expense[];
		supplierMap: Map<string, string>;
		tenantSlug: string;
		sortBy?: string | null;
		sortDir?: 'asc' | 'desc' | null;
		onSortChange: (sortBy: string, sortDir: 'asc' | 'desc') => void;
		onExpenseClick: (expense: Expense) => void;
		onEditExpense: (expense: Expense) => void;
		onDeleteExpense: (expenseId: string) => void;
		onViewInvoice: (expense: Expense) => void;
	};

	let {
		expenses,
		supplierMap,
		tenantSlug,
		sortBy = null,
		sortDir = 'asc',
		onSortChange,
		onExpenseClick,
		onEditExpense,
		onDeleteExpense,
		onViewInvoice
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
				<TableHead>Supplier</TableHead>
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
				<TableHead>Category</TableHead>
				<TableHead>Status</TableHead>
				<TableHead>Invoice</TableHead>
				<TableHead class="w-[50px]"></TableHead>
			</TableRow>
		</TableHeader>
		<TableBody>
			{#if expenses.length === 0}
				<TableRow>
					<TableCell colspan={8} class="text-center text-muted-foreground py-8">
						No expenses found
					</TableCell>
				</TableRow>
			{:else}
				{#each expenses as expense}
					<TableRow class="cursor-pointer hover:bg-accent/50" onclick={() => onExpenseClick(expense)}>
						<TableCell>{formatDate(expense.date)}</TableCell>
						<TableCell class="font-medium">{expense.description}</TableCell>
						<TableCell>
							{#if expense.supplierId}
								<span class="text-sm">{supplierMap.get(expense.supplierId) || 'Unknown'}</span>
							{:else}
								<span class="text-muted-foreground text-sm">-</span>
							{/if}
						</TableCell>
						<TableCell>
							<span class="text-red-600 font-semibold">
								-{formatCurrency(expense.amount, expense.currency)}
							</span>
							{#if expense.vatAmount}
								<div class="text-xs text-muted-foreground">
									VAT: {formatCurrency(expense.vatAmount, expense.currency)}
								</div>
							{/if}
						</TableCell>
						<TableCell>
							{#if expense.category}
								<Badge variant="secondary">{expense.category}</Badge>
							{:else}
								<span class="text-muted-foreground text-sm">-</span>
							{/if}
						</TableCell>
						<TableCell>
							{#if expense.isPaid}
								<Badge variant="default" class="bg-green-600">Paid</Badge>
							{:else}
								<Badge variant="secondary">Unpaid</Badge>
							{/if}
						</TableCell>
						<TableCell>
							{#if expense.invoicePath}
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8"
									onclick={(e) => {
										e.stopPropagation();
										onViewInvoice(expense);
									}}
								>
									<FileIcon class="h-4 w-4" />
								</Button>
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
									<DropdownMenuItem onclick={() => onEditExpense(expense)}>Edit</DropdownMenuItem>
									<DropdownMenuItem
										class="text-destructive"
										onclick={() => onDeleteExpense(expense.id)}
									>
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</TableCell>
					</TableRow>
				{/each}
			{/if}
		</TableBody>
	</Table>
</div>
