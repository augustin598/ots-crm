<script lang="ts">
	import { getMetaAdsSpendingList } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const spendingQuery = getMetaAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	let searchQuery = $state('');
	let sortColumn = $state<'periodStart' | 'spendCents'>('periodStart');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(10);
	let currentPage = $state(1);

	async function handleDownloadPDF(id: string, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `MetaAds-Cheltuieli-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		}
	}

	async function handlePreviewPDF(id: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare');
		}
	}

	function formatAmount(cents: number | null, currency: string): string {
		if (cents == null) return '-';
		const amount = cents / 100;
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(amount);
	}

	function formatPeriod(start: string): string {
		try {
			const d = new Date(start + 'T00:00:00');
			return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch {
			return start;
		}
	}

	function formatNumber(n: number | null): string {
		if (n == null) return '-';
		return n.toLocaleString('ro-RO');
	}

	const filteredSpending = $derived(
		searchQuery.trim() === ''
			? spending
			: spending.filter((s: any) =>
				(s.periodStart || '').includes(searchQuery.trim()) ||
				(s.metaAdAccountId || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
			)
	);

	const sortedSpending = $derived(
		[...filteredSpending].sort((a: any, b: any) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'periodStart':
					return dir * (a.periodStart || '').localeCompare(b.periodStart || '');
				case 'spendCents':
					return dir * ((a.spendCents || 0) - (b.spendCents || 0));
				default:
					return 0;
			}
		})
	);

	const totalEntries = $derived(filteredSpending.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedSpending = $derived(sortedSpending.slice(startIndex, endIndex));
	const showingFrom = $derived(totalEntries === 0 ? 0 : startIndex + 1);
	const showingTo = $derived(endIndex);

	const pageNumbers = $derived.by(() => {
		const pages: number[] = [];
		const maxVisible = 5;
		let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
		for (let i = start; i <= end; i++) pages.push(i);
		return pages;
	});

	$effect(() => {
		if (currentPage > totalPages) currentPage = totalPages;
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
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Cheltuieli Meta Ads</h1>
		<p class="text-muted-foreground">Rapoartele tale de cheltuieli Meta/Facebook Ads</p>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă rapoartele...</p>
	{:else if spending.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu sunt rapoarte de cheltuieli Meta Ads disponibile.</p>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				{showingFrom} - {showingTo} din {totalEntries}
			</p>
			<div class="relative w-64">
				<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input type="text" placeholder="Caută..." class="pl-9" bind:value={searchQuery} oninput={() => { currentPage = 1; }} />
			</div>
		</div>

		<div class="rounded-md border overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('periodStart')}>
								Perioadă <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead class="text-right">
							<button class="ml-auto flex items-center gap-2 hover:text-primary" onclick={() => handleSort('spendCents')}>
								Cheltuieli <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead class="text-right">Afișări</TableHead>
						<TableHead class="text-right">Click-uri</TableHead>
						<TableHead class="w-[80px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#if paginatedSpending.length === 0}
						<TableRow>
							<TableCell colspan={5} class="text-center text-muted-foreground py-8">
								Niciun raport găsit.
							</TableCell>
						</TableRow>
					{:else}
						{#each paginatedSpending as row}
							<TableRow>
								<TableCell class="font-medium">{formatPeriod(row.periodStart)}</TableCell>
								<TableCell class="text-right font-semibold">
									{formatAmount(row.spendCents, row.currencyCode)}
								</TableCell>
								<TableCell class="text-right">{formatNumber(row.impressions)}</TableCell>
								<TableCell class="text-right">{formatNumber(row.clicks)}</TableCell>
								<TableCell>
									<div class="flex items-center gap-1">
										{#if row.pdfPath}
											<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewPDF(row.id)} title="Preview PDF">
												<Eye class="h-4 w-4" />
											</Button>
											<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadPDF(row.id, row.periodStart)} title="Download PDF">
												<Download class="h-4 w-4" />
											</Button>
										{/if}
									</div>
								</TableCell>
							</TableRow>
						{/each}
					{/if}
				</TableBody>
			</Table>
		</div>

		{#if totalEntries > 0}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm">
					<span class="text-muted-foreground">Arată</span>
					<select
						class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm"
						value={pageSize.toString()}
						onchange={(e) => { pageSize = parseInt(e.currentTarget.value); currentPage = 1; }}
					>
						<option value="10">10</option>
						<option value="25">25</option>
						<option value="50">50</option>
					</select>
				</div>
				<div class="flex items-center gap-1">
					<Button variant="outline" size="sm" disabled={safePage <= 1} onclick={() => { currentPage = safePage - 1; }}>Anterior</Button>
					{#each pageNumbers as pn}
						<Button variant={pn === safePage ? 'default' : 'outline'} size="sm" class="w-8 h-8 p-0" onclick={() => { currentPage = pn; }}>{pn}</Button>
					{/each}
					<Button variant="outline" size="sm" disabled={safePage >= totalPages} onclick={() => { currentPage = safePage + 1; }}>Următor</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
