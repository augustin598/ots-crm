<script lang="ts">
	import {
		getSupplierInvoices,
		deleteSupplierInvoice,
		deleteSupplierInvoices,
		getLastSyncResults,
		createExpenseFromSupplierInvoice,
		linkSupplierInvoiceToExpense
	} from '$lib/remotes/supplier-invoices.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import {
		Plus,
		Trash2,
		FileText,
		ChevronLeft,
		ChevronRight,
		Info,
		X,
		Receipt,
		Eye,
		Download
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	const invoicesQuery = getSupplierInvoices();
	const allInvoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	// Sync results for notification banner
	const syncResultsQuery = getLastSyncResults();
	const lastSync = $derived(syncResultsQuery.current);
	let syncBannerDismissed = $state(false);

	// Check if banner should be shown (new imports since last dismiss)
	const showSyncBanner = $derived(() => {
		if (syncBannerDismissed || !lastSync?.imported || lastSync.imported === 0) return false;
		const lastSeen = typeof localStorage !== 'undefined' ? localStorage.getItem('lastSeenSyncTimestamp') : null;
		if (lastSeen && lastSync.timestamp && lastSeen >= lastSync.timestamp) return false;
		return true;
	});

	function dismissSyncBanner() {
		syncBannerDismissed = true;
		if (lastSync?.timestamp && typeof localStorage !== 'undefined') {
			localStorage.setItem('lastSeenSyncTimestamp', lastSync.timestamp);
		}
	}

	// Filters
	let statusFilter = $state<string>('');
	let supplierTypeFilter = $state<string>('');
	let searchText = $state('');

	const filteredInvoices = $derived(
		allInvoices.filter((inv) => {
			if (statusFilter && inv.status !== statusFilter) return false;
			if (supplierTypeFilter && inv.supplierType !== supplierTypeFilter) return false;
			if (searchText) {
				const search = searchText.toLowerCase();
				const matchesSearch =
					(inv.invoiceNumber || '').toLowerCase().includes(search) ||
					(inv.emailSubject || '').toLowerCase().includes(search) ||
					(inv.emailFrom || '').toLowerCase().includes(search) ||
					(inv.supplierName || '').toLowerCase().includes(search);
				if (!matchesSearch) return false;
			}
			return true;
		})
	);

	// Pagination
	let currentPage = $state(1);
	let pageSize = $state(25);

	const totalPages = $derived(Math.ceil(filteredInvoices.length / pageSize));
	const paginatedInvoices = $derived(
		filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize)
	);

	// Reset to page 1 when filters change
	$effect(() => {
		// Track filter dependencies
		statusFilter;
		supplierTypeFilter;
		searchText;
		// Reset page
		currentPage = 1;
	});

	const statusBadgeVariant = (status: string) => {
		switch (status) {
			case 'paid':
				return 'default' as const;
			case 'unpaid':
				return 'destructive' as const;
			default:
				return 'secondary' as const;
		}
	};

	const statusLabel = (status: string) => {
		switch (status) {
			case 'paid':
				return 'Plătită';
			case 'unpaid':
				return 'Neplătită';
			default:
				return 'În așteptare';
		}
	};

	const supplierTypeLabel = (type: string | null) => {
		switch (type) {
			case 'cpanel':
				return 'cPanel';
			case 'whmcs':
				return 'WHMCS';
			case 'hetzner':
				return 'Hetzner';
			case 'google':
				return 'Google';
			case 'ovh':
				return 'OVH';
			case 'digitalocean':
				return 'DigitalOcean';
			case 'aws':
				return 'AWS';
			default:
				return type || 'Necunoscut';
		}
	};

	// Selection state
	let selectedIds = $state(new Set<string>());
	const allPageSelected = $derived(
		paginatedInvoices.length > 0 && paginatedInvoices.every((inv) => selectedIds.has(inv.id))
	);
	const somePageSelected = $derived(
		paginatedInvoices.some((inv) => selectedIds.has(inv.id)) && !allPageSelected
	);

	function toggleSelectAll() {
		if (allPageSelected) {
			const next = new Set(selectedIds);
			for (const inv of paginatedInvoices) next.delete(inv.id);
			selectedIds = next;
		} else {
			const next = new Set(selectedIds);
			for (const inv of paginatedInvoices) next.add(inv.id);
			selectedIds = next;
		}
	}

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	let bulkDeleting = $state(false);
	let bulkDownloading = $state(false);

	async function handleBulkDelete() {
		const count = selectedIds.size;
		if (!confirm(`Ești sigur că vrei să ștergi ${count} facturi?`)) return;
		bulkDeleting = true;
		try {
			await deleteSupplierInvoices({ invoiceIds: [...selectedIds] }).updates(invoicesQuery);
			toast.success(`${count} facturi șterse`);
			selectedIds = new Set();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		} finally {
			bulkDeleting = false;
		}
	}

	async function handleBulkDownload() {
		bulkDownloading = true;
		try {
			const res = await fetch(`/${tenantSlug}/banking/supplier-invoices/download-zip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ invoiceIds: [...selectedIds] })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || 'Eroare la descărcare');
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'facturi.zip';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		} finally {
			bulkDownloading = false;
		}
	}

	let deleting = $state<string | null>(null);
	let creatingExpense = $state<string | null>(null);

	async function handleDelete(id: string) {
		if (!confirm('Ești sigur că vrei să ștergi această factură?')) return;
		deleting = id;
		try {
			await deleteSupplierInvoice(id).updates(invoicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Eroare la ștergere');
		} finally {
			deleting = null;
		}
	}

	async function handleCreateExpense(invoiceId: string) {
		creatingExpense = invoiceId;
		try {
			const result = await createExpenseFromSupplierInvoice(invoiceId).updates(invoicesQuery);
			toast.success('Cheltuială creată cu succes');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la creare cheltuială');
		} finally {
			creatingExpense = null;
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return '-';
		return new Date(date).toLocaleDateString('ro-RO');
	}
</script>

<div class="container mx-auto py-8 px-4">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold">Facturi Furnizori</h1>
			<p class="text-muted-foreground">Facturi importate din Gmail de la furnizori.</p>
		</div>
		<Button href="/{tenantSlug}/banking/supplier-invoices/import">
			<Plus class="h-4 w-4 mr-2" />
			Import din Gmail
		</Button>
	</div>

	<!-- Sync results notification banner -->
	{#if showSyncBanner()}
		<div
			class="mb-4 rounded-md bg-blue-50 border border-blue-200 p-4 flex items-center justify-between"
		>
			<div class="flex items-center gap-2">
				<Info class="h-4 w-4 text-blue-600" />
				<span class="text-sm text-blue-800">
					Sincronizare automată: {lastSync.imported} facturi noi importate
					{#if lastSync.errors > 0}, {lastSync.errors} erori{/if}
					{#if lastSync.timestamp}
						— {new Date(lastSync.timestamp).toLocaleString('ro-RO')}
					{/if}
				</span>
			</div>
			<Button variant="ghost" size="sm" onclick={dismissSyncBanner}>
				<X class="h-4 w-4" />
			</Button>
		</div>
	{/if}

	<!-- Filters -->
	<Card class="mb-6">
		<CardContent class="pt-4">
			<div class="flex flex-wrap gap-4 items-end">
				<div class="flex-1 min-w-[200px]">
					<Input
						placeholder="Caută după nr. factură, furnizor, subiect..."
						bind:value={searchText}
					/>
				</div>
				<Select type="single" value={statusFilter} onValueChange={(v) => (statusFilter = v)}>
					<SelectTrigger class="w-[160px]">
						{statusFilter ? statusLabel(statusFilter) : 'Toate statusurile'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">Toate</SelectItem>
						<SelectItem value="paid">Plătită</SelectItem>
						<SelectItem value="unpaid">Neplătită</SelectItem>
						<SelectItem value="pending">În așteptare</SelectItem>
					</SelectContent>
				</Select>
				<Select type="single" value={supplierTypeFilter} onValueChange={(v) => (supplierTypeFilter = v)}>
					<SelectTrigger class="w-[160px]">
						{supplierTypeFilter ? supplierTypeLabel(supplierTypeFilter) : 'Toți furnizorii'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">Toți</SelectItem>
						<SelectItem value="cpanel">cPanel</SelectItem>
						<SelectItem value="whmcs">WHMCS</SelectItem>
						<SelectItem value="hetzner">Hetzner</SelectItem>
						<SelectItem value="google">Google</SelectItem>
						<SelectItem value="ovh">OVH</SelectItem>
						<SelectItem value="digitalocean">DigitalOcean</SelectItem>
						<SelectItem value="aws">AWS</SelectItem>
						<SelectItem value="unknown">Altele</SelectItem>
					</SelectContent>
				</Select>
				<Select type="single" bind:value={pageSize} onValueChange={() => (currentPage = 1)}>
					<SelectTrigger class="w-[120px]">
						{pageSize} / pagină
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={10}>10</SelectItem>
						<SelectItem value={25}>25</SelectItem>
						<SelectItem value={50}>50</SelectItem>
						<SelectItem value={100}>100</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</CardContent>
	</Card>

	<!-- Bulk action bar -->
	{#if selectedIds.size > 0}
		<div class="mb-6 rounded-md border bg-muted/30 px-4 py-3 flex items-center justify-between">
			<span class="text-sm font-medium">{selectedIds.size} selectate</span>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={handleBulkDownload} disabled={bulkDownloading}>
					<Download class="h-4 w-4 mr-2" />
					{bulkDownloading ? 'Se descarcă...' : 'Descarcă selecția'}
				</Button>
				<Button variant="outline" size="sm" onclick={() => (selectedIds = new Set())}>
					Anulează selecția
				</Button>
				<Button variant="destructive" size="sm" onclick={handleBulkDelete} disabled={bulkDeleting}>
					<Trash2 class="h-4 w-4 mr-2" />
					{bulkDeleting ? 'Se șterge...' : 'Șterge selecția'}
				</Button>
			</div>
		</div>
	{/if}

	<!-- Table -->
	{#if loading}
		<p class="text-center text-muted-foreground py-8">Se încarcă...</p>
	{:else if filteredInvoices.length === 0}
		<Card>
			<CardContent class="py-12 text-center">
				<FileText class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
				<p class="text-lg font-medium">Nicio factură găsită</p>
				<p class="text-muted-foreground mb-4">
					{allInvoices.length > 0
						? 'Încearcă să modifici filtrele.'
						: 'Importă facturi din Gmail pentru a începe.'}
				</p>
				{#if allInvoices.length === 0}
					<Button href="/{tenantSlug}/banking/supplier-invoices/import">
						<Plus class="h-4 w-4 mr-2" />
						Import din Gmail
					</Button>
				{/if}
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardContent class="p-0">
				<div class="overflow-x-auto">
					<table class="w-full">
						<thead>
							<tr class="border-b bg-muted/50">
								<th class="w-10 p-3">
									<Checkbox
										checked={allPageSelected}
										indeterminate={somePageSelected}
										onCheckedChange={toggleSelectAll}
									/>
								</th>
								<th class="text-left p-3 font-medium">Furnizor</th>
								<th class="text-left p-3 font-medium">Nr. Factură</th>
								<th class="text-right p-3 font-medium">Sumă</th>
								<th class="text-left p-3 font-medium">Data</th>
								<th class="text-left p-3 font-medium">Status</th>
								<th class="text-left p-3 font-medium">Tip</th>
								<th class="text-right p-3 font-medium">Acțiuni</th>
							</tr>
						</thead>
						<tbody>
							{#each paginatedInvoices as invoice}
								<tr class="border-b hover:bg-muted/25">
									<td class="w-10 p-3">
										<Checkbox
											checked={selectedIds.has(invoice.id)}
											onCheckedChange={() => toggleSelect(invoice.id)}
										/>
									</td>
									<td class="p-3">
										<div class="font-medium">
											{invoice.supplierName || invoice.emailFrom || '-'}
										</div>
										<div class="text-xs text-muted-foreground truncate max-w-[200px]">
											{invoice.emailSubject || ''}
										</div>
									</td>
									<td class="p-3">{invoice.invoiceNumber || '-'}</td>
									<td class="p-3 text-right font-mono">
										{#if invoice.amount}
											{formatAmount(invoice.amount, invoice.currency as Currency)}
										{:else}
											-
										{/if}
									</td>
									<td class="p-3">{formatDate(invoice.issueDate)}</td>
									<td class="p-3">
										<Badge variant={statusBadgeVariant(invoice.status)}>
											{statusLabel(invoice.status)}
										</Badge>
									</td>
									<td class="p-3">
										<Badge variant="outline">{supplierTypeLabel(invoice.supplierType)}</Badge>
									</td>
									<td class="p-3 text-right">
										<div class="flex items-center justify-end gap-1">
											{#if invoice.pdfPath}
												<Button
													variant="ghost"
													size="sm"
													title="Vezi factura"
													href="/{tenantSlug}/banking/supplier-invoices/{invoice.id}/pdf"
													target="_blank"
												>
													<Eye class="h-4 w-4" />
												</Button>
											{/if}
											{#if invoice.expenseId}
												<Badge variant="secondary" class="text-xs cursor-pointer" onclick={() => goto(`/${tenantSlug}/banking/expenses`)}>
													Cheltuială
												</Badge>
											{:else}
												<Button
													variant="ghost"
													size="sm"
													title="Creează cheltuială"
													onclick={() => handleCreateExpense(invoice.id)}
													disabled={creatingExpense === invoice.id}
												>
													<Receipt class="h-4 w-4" />
												</Button>
											{/if}
											<Button
												variant="ghost"
												size="sm"
												onclick={() => handleDelete(invoice.id)}
												disabled={deleting === invoice.id}
											>
												<Trash2 class="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>

		<!-- Pagination -->
		<div class="flex items-center justify-between mt-4">
			<p class="text-sm text-muted-foreground">
				Afișare {(currentPage - 1) * pageSize + 1}-{Math.min(
					currentPage * pageSize,
					filteredInvoices.length
				)} din {filteredInvoices.length} facturi
				{#if filteredInvoices.length !== allInvoices.length}
					(total: {allInvoices.length})
				{/if}
			</p>
			{#if totalPages > 1}
				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage <= 1}
						onclick={() => (currentPage = currentPage - 1)}
					>
						<ChevronLeft class="h-4 w-4" />
						Anterior
					</Button>
					<span class="text-sm text-muted-foreground">
						Pagina {currentPage} / {totalPages}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage >= totalPages}
						onclick={() => (currentPage = currentPage + 1)}
					>
						Următor
						<ChevronRight class="h-4 w-4" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
