<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useQueryState } from 'nuqs-svelte';
	import { parseAsString, parseAsStringEnum, parseAsInteger } from 'nuqs-svelte';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import TableIcon from '@lucide/svelte/icons/table';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import LeadKanbanBoard from '$lib/components/lead-kanban-board.svelte';
	import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '$lib/components/lead-kanban-utils';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange } from '$lib/utils/report-helpers';
	import {
		getLeads,
		triggerLeadSync,
		updateLeadStatus,
		bulkUpdateLeadStatus,
		getMetaAdsPages,
		getLastSyncInfo
	} from '$lib/remotes/leads.remote';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	// URL-based filter state
	const search = useQueryState('search', parseAsString.withDefault(''));
	const statusFilter = useQueryState('status', parseAsStringEnum(['new', 'contacted', 'qualified', 'converted', 'disqualified']));
	const pageFilter = useQueryState('page', parseAsString);
	const pageNum = useQueryState('p', parseAsInteger.withDefault(1));
	const view = useQueryState('view', parseAsStringEnum(['kanban', 'table']).withDefault('table'));

	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	let pageSize = $state(25);
	let syncing = $state(false);
	let selectedIds = $state<Set<string>>(new Set());

	const statusOptions = [
		{ value: '', label: 'Toate' },
		{ value: 'new', label: 'Nou' },
		{ value: 'contacted', label: 'Contactat' },
		{ value: 'qualified', label: 'Calificat' },
		{ value: 'converted', label: 'Convertit' },
		{ value: 'disqualified', label: 'Descalificat' }
	];

	const statusColors: Record<string, string> = {
		new: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
		contacted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
		qualified: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
		converted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
		disqualified: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
	};

	const statusLabels: Record<string, string> = {
		new: 'Nou',
		contacted: 'Contactat',
		qualified: 'Calificat',
		converted: 'Convertit',
		disqualified: 'Descalificat'
	};

	// Build filter params reactively
	const filterParams = $derived({
		platform: 'facebook' as const,
		status: statusFilter.current || undefined,
		search: search.current || undefined,
		pageId: pageFilter.current || undefined,
		dateFrom: since || undefined,
		dateTo: until || undefined,
		limit: view.current === 'kanban' ? 500 : pageSize,
		offset: view.current === 'kanban' ? 0 : ((pageNum.current || 1) - 1) * pageSize
	});

	// Reactive queries
	const leadsQuery = $derived(getLeads(filterParams));
	const leadsData = $derived(leadsQuery.current || { rows: [], totalCount: 0 });
	const leads = $derived(leadsData.rows);
	const totalCount = $derived(leadsData.totalCount);
	const loading = $derived(leadsQuery.loading);

	const totalPages = $derived(Math.ceil(totalCount / pageSize));
	const currentPage = $derived(pageNum.current || 1);

	const pagesQuery = getMetaAdsPages();
	const monitoredPages = $derived((pagesQuery.current || []).filter((p: any) => p.isMonitored));

	const syncInfoQuery = getLastSyncInfo();
	const syncInfo = $derived(syncInfoQuery.current);

	// Reset to page 1 when filters change
	$effect(() => {
		// Access filter values to track them
		search.current;
		statusFilter.current;
		pageFilter.current;
		pageNum.set(1);
	});

	const allSelected = $derived(leads.length > 0 && leads.every((l: any) => selectedIds.has(l.id)));

	function toggleSelectAll() {
		if (allSelected) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(leads.map((l: any) => l.id));
		}
	}

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerLeadSync({ platform: 'facebook' });
			toast.success(`Sync finalizat: ${result.imported} noi, ${result.skipped} existente`);
			leadsQuery.refetch();
			syncInfoQuery.refetch();
		} catch (e) {
			toast.error('Sync eșuat');
		} finally {
			syncing = false;
		}
	}

	async function handleStatusChange(leadId: string, newStatus: string) {
		try {
			await updateLeadStatus({ leadId, status: newStatus as any });
			toast.success('Status actualizat');
			leadsQuery.refetch();
		} catch (e) {
			toast.error('Eroare la actualizare status');
		}
	}

	async function handleBulkStatus(newStatus: string) {
		if (selectedIds.size === 0) return;
		try {
			await bulkUpdateLeadStatus({ leadIds: [...selectedIds], status: newStatus as any });
			toast.success(`${selectedIds.size} leaduri actualizate`);
			selectedIds = new Set();
			leadsQuery.refetch();
		} catch (e) {
			toast.error('Eroare la actualizare în masă');
		}
	}

	function exportCSV() {
		if (leads.length === 0) return;
		const headers = ['Nume', 'Email', 'Telefon', 'Formular', 'Status', 'Data', 'Note'];
		const rows = leads.map((l: any) => [
			l.fullName || '',
			l.email || '',
			l.phoneNumber || '',
			l.formName || '',
			statusLabels[l.status] || l.status,
			formatDate(l.externalCreatedAt),
			(l.notes || '').replace(/"/g, '""')
		]);
		const csv = [headers.join(','), ...rows.map((r: string[]) => r.map((c) => `"${c}"`).join(','))].join('\n');
		const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `facebook-leads-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function formatRelativeTime(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		const diff = Date.now() - d.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'acum';
		if (mins < 60) return `acum ${mins} min`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `acum ${hours}h`;
		const days = Math.floor(hours / 24);
		return `acum ${days}z`;
	}

	let debounceTimer: ReturnType<typeof setTimeout>;
	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => search.set(val), 300);
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconFacebook class="h-8 w-8" />
				Facebook Ads Leads
			</h1>
			<p class="text-muted-foreground">
				Leaduri din campaniile Facebook & Instagram
				{#if syncInfo?.lastSyncAt}
					<span class="text-xs ml-2">· Ultimul sync: {formatRelativeTime(syncInfo.lastSyncAt)}</span>
				{/if}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex items-center gap-1 border rounded-md p-1">
				<Button
					variant={view.current === 'kanban' ? 'default' : 'ghost'}
					size="sm"
					onclick={() => (view.current = 'kanban')}
				>
					<LayoutGridIcon class="h-4 w-4 mr-1" />
					Kanban
				</Button>
				<Button
					variant={view.current === 'table' ? 'default' : 'ghost'}
					size="sm"
					onclick={() => (view.current = 'table')}
				>
					<TableIcon class="h-4 w-4 mr-1" />
					Table
				</Button>
			</div>
			<DateRangePicker bind:since bind:until onchange={() => pageNum.set(1)} />
			{#if monitoredPages.length > 0}
				<div class="flex items-center gap-2">
					<select
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						value={pageFilter.current || ''}
						onchange={(e) => pageFilter.set(e.currentTarget.value || null)}
					>
						<option value="">Toate paginile</option>
						{#each monitoredPages as pg (pg.id)}
							<option value={pg.id}>{pg.pageName}</option>
						{/each}
					</select>
				</div>
			{/if}
			<Button onclick={exportCSV} variant="outline" size="sm" disabled={leads.length === 0}>
				<DownloadIcon class="h-4 w-4" />
			</Button>
			<Button onclick={handleSync} disabled={syncing} variant="outline" size="sm">
				<RefreshCwIcon class="h-4 w-4 {syncing ? 'animate-spin' : ''}" />
			</Button>
			<Button href="/{tenantSlug}/settings/meta-ads" variant="outline" size="sm">
				Setări
			</Button>
		</div>
	</div>

	<!-- Filters -->
	<div class="flex flex-col sm:flex-row gap-3">
		<div class="relative flex-1 max-w-sm">
			<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
			<Input
				placeholder="Caută după nume, email, telefon..."
				class="pl-9"
				value={search.current}
				oninput={handleSearchInput}
			/>
		</div>
		<Select.Root onValueChange={(val) => statusFilter.set(val || null)}>
			<Select.Trigger class="w-[180px]">
				{statusOptions.find((o) => o.value === (statusFilter.current || ''))?.label || 'Status'}
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as opt (opt.value)}
					<Select.Item value={opt.value}>{opt.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- Bulk action bar (table view only) -->
	{#if view.current === 'table' && selectedIds.size > 0}
		<div class="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
			<span class="text-sm font-medium">{selectedIds.size} selectate</span>
			<Select.Root onValueChange={(val) => handleBulkStatus(val)}>
				<Select.Trigger class="h-8 w-[180px]">
					Schimbă status
				</Select.Trigger>
				<Select.Content>
					{#each statusOptions.filter((o) => o.value) as opt (opt.value)}
						<Select.Item value={opt.value}>{opt.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button variant="ghost" size="sm" onclick={() => (selectedIds = new Set())}>
				Deselectează
			</Button>
		</div>
	{/if}

	<!-- Content -->
	{#if view.current === 'kanban'}
		{#if loading && leads.length === 0}
			<div class="flex items-center justify-center py-12">
				<RefreshCwIcon class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if leads.length === 0 && !loading}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<ContactIcon class="h-12 w-12 text-muted-foreground mb-4" />
				<h3 class="text-lg font-semibold">Niciun lead găsit</h3>
				<p class="text-sm text-muted-foreground mt-1">
					{search.current || statusFilter.current || pageFilter.current
						? 'Încearcă alte filtre'
						: 'Apasă "Sync Now" pentru a importa leaduri din Facebook'}
				</p>
			</div>
		{:else}
			<LeadKanbanBoard
				{leads}
				readonly={false}
				{tenantSlug}
				onLeadClick={(lead) => goto(`/${tenantSlug}/leads/${lead.id}`)}
				onStatusChange={async (leadId, newStatus) => {
					await handleStatusChange(leadId, newStatus);
				}}
			/>
		{/if}
	{:else if loading && leads.length === 0}
		<div class="rounded-md border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-[40px]"></Table.Head>
						<Table.Head>Nume</Table.Head>
						<Table.Head>Email</Table.Head>
						<Table.Head>Telefon</Table.Head>
						<Table.Head>Formular</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Data</Table.Head>
						<Table.Head class="w-[50px]"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each Array(5) as _, i (i)}
						<Table.Row>
							{#each Array(8) as _, j (j)}
								<Table.Cell>
									<div class="h-4 bg-muted animate-pulse rounded w-{j === 0 ? '4' : j < 4 ? '24' : '16'}"></div>
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{:else if leads.length === 0 && !loading}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ContactIcon class="h-12 w-12 text-muted-foreground mb-4" />
			<h3 class="text-lg font-semibold">Niciun lead găsit</h3>
			<p class="text-sm text-muted-foreground mt-1">
				{search.current || statusFilter.current || pageFilter.current
					? 'Încearcă alte filtre'
					: 'Apasă "Sync Now" pentru a importa leaduri din Facebook'}
			</p>
		</div>
	{:else}
		<div class="rounded-md border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-[40px]">
							<Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
						</Table.Head>
						<Table.Head>Nume</Table.Head>
						<Table.Head>Email</Table.Head>
						<Table.Head>Telefon</Table.Head>
						<Table.Head>Formular</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Data</Table.Head>
						<Table.Head class="w-[50px]"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each leads as lead (lead.id)}
						<Table.Row
							class="cursor-pointer hover:bg-muted/50 {selectedIds.has(lead.id) ? 'bg-muted/30' : ''}"
							onclick={() => goto(`/${tenantSlug}/leads/${lead.id}`)}
						>
							<Table.Cell onclick={(e) => e.stopPropagation()}>
								<Checkbox
									checked={selectedIds.has(lead.id)}
									onCheckedChange={() => toggleSelect(lead.id)}
								/>
							</Table.Cell>
							<Table.Cell class="font-medium">{lead.fullName || '-'}</Table.Cell>
							<Table.Cell>{lead.email || '-'}</Table.Cell>
							<Table.Cell>{lead.phoneNumber || '-'}</Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground">{lead.formName || '-'}</Table.Cell>
							<Table.Cell>
								<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {statusColors[lead.status] || ''}">
									{statusLabels[lead.status] || lead.status}
								</span>
							</Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground">{formatDate(lead.externalCreatedAt)}</Table.Cell>
							<Table.Cell onclick={(e) => e.stopPropagation()}>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										<Button variant="ghost" size="sm" class="h-7 w-7 p-0">
											<EllipsisVerticalIcon class="h-4 w-4" />
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										{#each statusOptions.filter((o) => o.value && o.value !== lead.status) as opt (opt.value)}
											<DropdownMenu.Item onclick={() => handleStatusChange(lead.id, opt.value)}>
												{opt.label}
											</DropdownMenu.Item>
										{/each}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<p class="text-sm text-muted-foreground">
					{Math.min((currentPage - 1) * pageSize + 1, totalCount)}-{Math.min(currentPage * pageSize, totalCount)} din {totalCount} leaduri
				</p>
				<select
					class="h-8 rounded-md border border-input bg-background px-2 text-sm"
					bind:value={pageSize}
					onchange={() => pageNum.set(1)}
				>
					<option value={10}>10 / pagină</option>
					<option value={25}>25 / pagină</option>
					<option value={50}>50 / pagină</option>
				</select>
			</div>
			{#if totalPages > 1}
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled={currentPage <= 1} onclick={() => pageNum.set(currentPage - 1)}>
						<ChevronLeftIcon class="h-4 w-4" />
					</Button>
					<span class="text-sm text-muted-foreground">Pagina {currentPage} / {totalPages}</span>
					<Button variant="outline" size="sm" disabled={currentPage >= totalPages} onclick={() => pageNum.set(currentPage + 1)}>
						<ChevronRightIcon class="h-4 w-4" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
