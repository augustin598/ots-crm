<script lang="ts">
	import { getMetaAdsSpendingList, deleteMetaAdsSpending, triggerMetaAdsSync, regenerateSpendingPdf } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye, Trash2 } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const spendingQuery = getMetaAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	let syncing = $state(false);
	let regeneratingId = $state<string | null>(null);
	let searchQuery = $state('');
	let sortColumn = $state<'clientName' | 'periodStart' | 'spendCents'>('periodStart');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(25);
	let currentPage = $state(1);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerMetaAdsSync().updates(spendingQuery);
			toast.success(`Sync complet: ${result.imported} noi, ${result.updated} actualizate, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sincronizare');
		} finally {
			syncing = false;
		}
	}

	async function handleDelete(id: string) {
		if (!confirm('Ești sigur că vrei să ștergi acest raport?')) return;
		try {
			await deleteMetaAdsSpending(id).updates(spendingQuery);
			toast.success('Raport șters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handleRegenerate(spendingId: string) {
		regeneratingId = spendingId;
		try {
			await regenerateSpendingPdf(spendingId).updates(spendingQuery);
			toast.success('PDF regenerat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la regenerare PDF');
		} finally {
			regeneratingId = null;
		}
	}

	async function handleDownloadPDF(id: string, period: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/meta-ads/${id}/pdf`);
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
			const response = await fetch(`/${tenantSlug}/invoices/meta-ads/${id}/pdf`);
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
				(s.clientName || '').toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
				(s.businessName || '').toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
				(s.metaAdAccountId || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
			)
	);

	const sortedSpending = $derived(
		[...filteredSpending].sort((a: any, b: any) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'clientName':
					return dir * (a.clientName || '').localeCompare(b.clientName || '');
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
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Cheltuieli Meta Ads</h1>
			<p class="text-muted-foreground">Rapoarte cheltuieli Meta/Facebook Ads pentru toți clienții</p>
		</div>
		<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
			{#if syncing}
				<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />
				Sincronizare...
			{:else}
				<RefreshCwIcon class="mr-2 h-4 w-4" />
				Sync Acum
			{/if}
		</Button>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă rapoartele...</p>
	{:else if spending.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu sunt date de cheltuieli Meta Ads sincronizate.</p>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				{startIndex + 1} - {endIndex} din {totalEntries}
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
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('clientName')}>
								Client <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead>BM</TableHead>
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
						<TableHead>Status</TableHead>
						<TableHead class="w-[150px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each paginatedSpending as row}
						<TableRow>
							<TableCell class="font-medium">{row.clientName || '-'}</TableCell>
							<TableCell class="text-sm text-muted-foreground">{row.businessName || '-'}</TableCell>
							<TableCell>{formatPeriod(row.periodStart)}</TableCell>
							<TableCell class="text-right font-semibold">
								{formatAmount(row.spendCents, row.currencyCode)}
							</TableCell>
							<TableCell class="text-right">{formatNumber(row.impressions)}</TableCell>
							<TableCell class="text-right">{formatNumber(row.clicks)}</TableCell>
							<TableCell>
								{#if row.pdfPath}
									<span class="inline-flex items-center rounded-full border border-green-500 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">
										OK
									</span>
								{:else}
									<span class="inline-flex items-center rounded-full border border-yellow-500 px-2 py-0.5 text-xs font-medium text-yellow-700 bg-yellow-50">
										Pending
									</span>
								{/if}
							</TableCell>
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
									{#if !row.pdfPath}
										<Button variant="ghost" size="icon" class="h-8 w-8 text-blue-500" onclick={() => handleRegenerate(row.id)} disabled={regeneratingId === row.id} title="Regenerează PDF">
											{#if regeneratingId === row.id}
												<RefreshCwIcon class="h-4 w-4 animate-spin" />
											{:else}
												<RefreshCwIcon class="h-4 w-4" />
											{/if}
										</Button>
									{/if}
									<Button variant="ghost" size="icon" class="h-8 w-8 text-red-500" onclick={() => handleDelete(row.id)} title="Șterge">
										<Trash2 class="h-4 w-4" />
									</Button>
								</div>
							</TableCell>
						</TableRow>
					{/each}
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
