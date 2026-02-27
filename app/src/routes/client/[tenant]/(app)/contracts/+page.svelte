<script lang="ts">
	import { getContracts } from '$lib/remotes/contracts.remote';
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
	import { Download, Search } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';

	const tenantSlug = $derived(page.params.tenant as string);

	const contractsQuery = getContracts({});
	const contracts = $derived(contractsQuery.current || []);
	const loading = $derived(contractsQuery.loading);

	async function handleDownloadPDF(contractId: string, contractNumber: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/contracts/${contractId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Contract-${contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to download PDF');
		}
	}

	// --- Table state ---
	let searchQuery = $state('');
	let sortColumn = $state<'contractNumber' | 'contractDate' | 'status'>('contractDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(10);
	let currentPage = $state(1);

	// --- Derived: filter -> sort -> paginate ---
	const filteredContracts = $derived(
		searchQuery.trim() === ''
			? contracts
			: contracts.filter((c) =>
					c.contractNumber.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
					c.contractTitle.toLowerCase().includes(searchQuery.trim().toLowerCase())
				)
	);

	const sortedContracts = $derived(
		[...filteredContracts].sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'contractNumber':
					return (
						dir *
						a.contractNumber.localeCompare(b.contractNumber, undefined, { numeric: true })
					);
				case 'contractDate': {
					const dateA = a.contractDate ? new Date(a.contractDate).getTime() : 0;
					const dateB = b.contractDate ? new Date(b.contractDate).getTime() : 0;
					return dir * (dateA - dateB);
				}
				case 'status':
					return dir * a.status.localeCompare(b.status);
				default:
					return 0;
			}
		})
	);

	const totalEntries = $derived(filteredContracts.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedContracts = $derived(sortedContracts.slice(startIndex, endIndex));
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
			case 'active':
			case 'signed':
				return 'border-green-500 text-green-700 bg-green-50';
			case 'sent':
				return 'border-blue-500 text-blue-700 bg-blue-50';
			case 'expired':
			case 'cancelled':
				return 'border-red-500 text-red-700 bg-red-50';
			case 'draft':
				return 'border-gray-400 text-gray-600 bg-gray-50';
			default:
				return 'border-gray-400 text-gray-600 bg-gray-50';
		}
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { year: 'numeric', month: 'short', day: 'numeric' });
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
	<div>
		<h1 class="text-3xl font-bold">Contractele mele</h1>
		<p class="text-muted-foreground">Vizualizati contractele dumneavoastra</p>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se incarca contractele...</p>
	{:else if contracts.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu exista contracte inca.</p>
		</div>
	{:else}
		<!-- Info bar -->
		<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				{showingFrom} - {showingTo} din {totalEntries}
			</p>
			<div class="relative w-64">
				<Search
					class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="text"
					placeholder="Cauta..."
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
								onclick={() => handleSort('contractNumber')}
							>
								Nr. Contract
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'contractNumber'}
									<span>{getSortIcon('contractNumber')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead>Titlu</TableHead>
						<TableHead>
							<button
								class="flex items-center gap-2 hover:text-primary"
								onclick={() => handleSort('contractDate')}
							>
								Data
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'contractDate'}
									<span>{getSortIcon('contractDate')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead>
							<button
								class="flex items-center gap-2 hover:text-primary"
								onclick={() => handleSort('status')}
							>
								Status
								<ArrowUpDownIcon class="h-4 w-4" />
								{#if sortColumn === 'status'}
									<span>{getSortIcon('status')}</span>
								{/if}
							</button>
						</TableHead>
						<TableHead class="w-[50px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#if paginatedContracts.length === 0}
						<TableRow>
							<TableCell colspan={5} class="text-center text-muted-foreground py-8">
								Nu s-au gasit contracte.
							</TableCell>
						</TableRow>
					{:else}
						{#each paginatedContracts as contract}
							<TableRow>
								<TableCell class="font-medium">{contract.contractNumber}</TableCell>
								<TableCell>{contract.contractTitle}</TableCell>
								<TableCell>{formatDate(contract.contractDate)}</TableCell>
								<TableCell>
									<span
										class="inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium capitalize {getStatusColor(contract.status)}"
									>
										{contract.status}
									</span>
								</TableCell>
								<TableCell>
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8"
										onclick={() =>
											handleDownloadPDF(contract.id, contract.contractNumber)}
										title="Descarca PDF"
									>
										<Download class="h-4 w-4" />
									</Button>
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
					<span class="text-muted-foreground">Arata</span>
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
					<span class="text-muted-foreground">intrari</span>
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
						Inapoi
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
						Inainte
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
