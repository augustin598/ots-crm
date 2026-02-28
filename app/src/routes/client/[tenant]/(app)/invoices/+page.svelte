<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { syncInvoicesFromKeez, getKeezStatus } from '$lib/remotes/keez.remote';
	import { page } from '$app/state';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	async function handleDownloadPDF(invoiceId: string, invoiceNumber: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Factura-${invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to download PDF');
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to preview PDF');
		}
	}

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	const keezStatusQuery = getKeezStatus();
	const keezStatus = $derived(keezStatusQuery.current);
	const isKeezActive = $derived(keezStatus?.connected && keezStatus?.isActive);

	let syncingInvoices = $state(false);
	let syncError = $state<string | null>(null);
	let syncResult = $state<{ imported: number; updated: number; skipped: number } | null>(null);

	async function handleSyncInvoices() {
		syncingInvoices = true;
		syncError = null;
		syncResult = null;

		try {
			const result = await syncInvoicesFromKeez({}).updates(invoicesQuery, keezStatusQuery);

			if (result.success) {
				syncResult = {
					imported: result.imported,
					updated: result.updated || 0,
					skipped: result.skipped
				};
				await invoicesQuery.refresh();
				setTimeout(() => {
					syncResult = null;
				}, 5000);
			}
		} catch (e) {
			syncError = e instanceof Error ? e.message : 'Failed to sync invoices';
		} finally {
			syncingInvoices = false;
		}
	}

	// --- Table state ---
	let searchQuery = $state('');
	let sortColumn = $state<'invoiceNumber' | 'issueDate' | 'dueDate' | 'totalAmount'>('issueDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(10);
	let currentPage = $state(1);

	// --- Derived: filter -> sort -> paginate ---
	const filteredInvoices = $derived(
		searchQuery.trim() === ''
			? invoices
			: invoices.filter((inv) =>
					inv.invoiceNumber.toLowerCase().includes(searchQuery.trim().toLowerCase())
				)
	);

	const sortedInvoices = $derived(
		[...filteredInvoices].sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'invoiceNumber':
					return (
						dir *
						a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true })
					);
				case 'issueDate': {
					const dateA = a.issueDate ? new Date(a.issueDate).getTime() : 0;
					const dateB = b.issueDate ? new Date(b.issueDate).getTime() : 0;
					return dir * (dateA - dateB);
				}
				case 'dueDate': {
					const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
					const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
					return dir * (dateA - dateB);
				}
				case 'totalAmount':
					return dir * ((a.totalAmount || 0) - (b.totalAmount || 0));
				default:
					return 0;
			}
		})
	);

	const totalEntries = $derived(filteredInvoices.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedInvoices = $derived(sortedInvoices.slice(startIndex, endIndex));
	const showingFrom = $derived(totalEntries === 0 ? 0 : startIndex + 1);
	const showingTo = $derived(endIndex);

	const pageNumbers = $derived.by(() => {
		const pages: number[] = [];
		const maxVisible = 5;
		let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) {
			start = Math.max(1, end - maxVisible + 1);
		}
		for (let i = start; i <= end; i++) {
			pages.push(i);
		}
		return pages;
	});

	$effect(() => {
		if (currentPage > totalPages) {
			currentPage = totalPages;
		}
	});

	function handleSort(column: typeof sortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}
		currentPage = 1;
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'paid':
				return 'border-green-500 text-green-700 bg-green-50';
			case 'sent':
				return 'border-blue-500 text-blue-700 bg-blue-50';
			case 'overdue':
				return 'border-red-500 text-red-700 bg-red-50';
			case 'draft':
				return 'border-gray-400 text-gray-600 bg-gray-50';
			case 'cancelled':
				return 'border-red-400 text-red-600 bg-red-50';
			default:
				return 'border-gray-400 text-gray-600 bg-gray-50';
		}
	}

	function getOrdinalSuffix(day: number): string {
		if (day > 3 && day < 21) return 'th';
		switch (day % 10) {
			case 1:
				return 'st';
			case 2:
				return 'nd';
			case 3:
				return 'rd';
			default:
				return 'th';
		}
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			const day = d.getDate();
			const suffix = getOrdinalSuffix(day);
			const month = d.toLocaleDateString('en-US', { month: 'short' });
			const year = d.getFullYear();
			return `${day}${suffix} ${month} ${year}`;
		} catch {
			return '-';
		}
	}

	function getSortIcon(column: string): string {
		if (sortColumn !== column) return '';
		return sortDirection === 'asc' ? '\u2191' : '\u2193';
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">My Invoices</h1>
			<p class="text-muted-foreground">Your invoice history with us</p>
		</div>
		{#if isKeezActive}
			<Button
				variant="outline"
				size="sm"
				onclick={handleSyncInvoices}
				disabled={syncingInvoices}
			>
				{#if syncingInvoices}
					<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />
					Syncing...
				{:else}
					<RefreshCwIcon class="mr-2 h-4 w-4" />
					Refresh Statuses
				{/if}
			</Button>
		{/if}
	</div>

	{#if syncError}
		<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
			<p class="text-sm text-red-800 dark:text-red-200">{syncError}</p>
		</div>
	{/if}

	{#if syncResult}
		<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
			<p class="text-sm text-green-800 dark:text-green-200">
				Statuses updated successfully
			</p>
		</div>
	{/if}

	{#if loading}
		<p class="text-muted-foreground">Loading invoices...</p>
	{:else if invoices.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">No invoices yet.</p>
		</div>
	{:else}
		<!-- Info bar -->
		<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				Showing {showingFrom} to {showingTo} of {totalEntries} entries
			</p>
			<div class="relative w-64">
				<Search
					class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="text"
					placeholder="Search..."
					class="pl-9"
					bind:value={searchQuery}
					oninput={() => {
						currentPage = 1;
					}}
				/>
			</div>
		</div>

		<!-- Table -->
		<div class="rounded-md border overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							<button
								class="flex items-center gap-2 hover:text-primary"
								onclick={() => handleSort('invoiceNumber')}
							>
								Invoice #
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'invoiceNumber'}
									<span>{getSortIcon('invoiceNumber')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead>
							<button
								class="flex items-center gap-2 hover:text-primary"
								onclick={() => handleSort('issueDate')}
							>
								Invoice Date
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'issueDate'}
									<span>{getSortIcon('issueDate')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead>
							<button
								class="flex items-center gap-2 hover:text-primary"
								onclick={() => handleSort('dueDate')}
							>
								Due Date
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'dueDate'}
									<span>{getSortIcon('dueDate')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead class="text-right">
							<button
								class="ml-auto flex items-center gap-2 hover:text-primary"
								onclick={() => handleSort('totalAmount')}
							>
								Total
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'totalAmount'}
									<span>{getSortIcon('totalAmount')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead>Status</TableHead>
						<TableHead class="w-[50px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#if paginatedInvoices.length === 0}
						<TableRow>
							<TableCell colspan={6} class="text-center text-muted-foreground py-8">
								No invoices match your search.
							</TableCell>
						</TableRow>
					{:else}
						{#each paginatedInvoices as invoice}
							<TableRow>
								<TableCell class="font-medium">{invoice.invoiceNumber}</TableCell>
								<TableCell>{formatDate(invoice.issueDate)}</TableCell>
								<TableCell>{formatDate(invoice.dueDate)}</TableCell>
								<TableCell class="text-right font-semibold">
									{formatAmount(invoice.totalAmount, invoice.currency as Currency)}
								</TableCell>
								<TableCell>
									<span
										class="inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium capitalize {getStatusColor(invoice.status)}"
									>
										{invoice.status}
									</span>
								</TableCell>
								<TableCell>
									<div class="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											class="h-8 w-8"
											onclick={() => handlePreviewPDF(invoice.id)}
											title="Preview PDF"
										>
											<Eye class="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											class="h-8 w-8"
											onclick={() =>
												handleDownloadPDF(invoice.id, invoice.invoiceNumber)}
											title="Download PDF"
										>
											<Download class="h-4 w-4" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						{/each}
					{/if}
				</TableBody>
			</Table>
		</div>

		<!-- Pagination -->
		{#if totalEntries > 0}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm">
					<span class="text-muted-foreground">Show</span>
					<select
						class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm"
						value={pageSize.toString()}
						onchange={(e) => {
							pageSize = parseInt(e.currentTarget.value);
							currentPage = 1;
						}}
					>
						<option value="10">10</option>
						<option value="25">25</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
					<span class="text-muted-foreground">entries</span>
				</div>

				<div class="flex items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						disabled={safePage <= 1}
						onclick={() => {
							currentPage = safePage - 1;
						}}
					>
						Previous
					</Button>
					{#each pageNumbers as pn}
						<Button
							variant={pn === safePage ? 'default' : 'outline'}
							size="sm"
							class="w-8 h-8 p-0"
							onclick={() => {
								currentPage = pn;
							}}
						>
							{pn}
						</Button>
					{/each}
					<Button
						variant="outline"
						size="sm"
						disabled={safePage >= totalPages}
						onclick={() => {
							currentPage = safePage + 1;
						}}
					>
						Next
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
