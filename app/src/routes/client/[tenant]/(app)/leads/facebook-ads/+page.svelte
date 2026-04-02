<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import TableIcon from '@lucide/svelte/icons/table';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import LeadKanbanBoard from '$lib/components/lead-kanban-board.svelte';
	import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '$lib/components/lead-kanban-utils';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getLeads, getMetaAdsPages, updateLeadStatus } from '$lib/remotes/leads.remote';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	let since = $state('');
	let until = $state('');

	let leads = $state<any[]>([]);
	let kanbanLeads = $state<any[]>([]);
	let totalCount = $state(0);
	let loading = $state(true);
	let search = $state('');
	let statusFilter = $state('');
	let pageFilter = $state('');
	let currentPage = $state(1);
	let pageSize = $state(25);
	let currentView = $state<'table' | 'kanban'>('table');

	const totalPages = $derived(Math.ceil(totalCount / pageSize));

	const statusOptions = [
		{ value: '', label: 'Toate' },
		{ value: 'new', label: 'Nou' },
		{ value: 'contacted', label: 'Contactat' },
		{ value: 'qualified', label: 'Calificat' },
		{ value: 'converted', label: 'Convertit' },
		{ value: 'disqualified', label: 'Descalificat' }
	];

	const statusColors: Record<string, string> = {
		new: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-200',
		contacted: 'bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-200',
		qualified: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200',
		converted: 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-200',
		disqualified: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-200'
	};

	const statusLabels: Record<string, string> = {
		new: 'Nou',
		contacted: 'Contactat',
		qualified: 'Calificat',
		converted: 'Convertit',
		disqualified: 'Descalificat'
	};

	// Get pages linked to this client (for page filter)
	const pagesQuery = getMetaAdsPages();
	const clientPages = $derived(pagesQuery.current || []);

	$effect(() => {
		loadLeads();
	});

	async function loadLeads() {
		loading = true;
		try {
			const baseParams = {
				platform: 'facebook' as const,
				status: statusFilter || undefined,
				search: search || undefined,
				pageId: pageFilter || undefined,
				dateFrom: since || undefined,
				dateTo: until || undefined
			};

			if (currentView === 'kanban') {
				const result = await getLeads({ ...baseParams, limit: 500, offset: 0 });
				kanbanLeads = result.rows;
				leads = result.rows;
				totalCount = result.totalCount;
			} else {
				const result = await getLeads({
					...baseParams,
					limit: pageSize,
					offset: (currentPage - 1) * pageSize
				});
				leads = result.rows;
				totalCount = result.totalCount;
			}
		} catch (e) {
			console.error('Failed to load leads:', e);
		} finally {
			loading = false;
		}
	}

	function switchView(v: 'table' | 'kanban') {
		currentView = v;
		loadLeads();
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function exportCSV() {
		if (leads.length === 0) return;
		const headers = ['Nume', 'Email', 'Telefon', 'Formular', 'Status', 'Data'];
		const rows = leads.map((l: any) => [
			l.fullName || '',
			l.email || '',
			l.phoneNumber || '',
			l.formName || '',
			statusLabels[l.status] || l.status,
			formatDate(l.externalCreatedAt)
		]);
		const csv = [headers.join(','), ...rows.map((r: string[]) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
		const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `facebook-leads-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	let debounceTimer: ReturnType<typeof setTimeout>;
	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		search = val;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => { currentPage = 1; loadLeads(); }, 300);
	}

	function handleFilterChange(value: string) {
		statusFilter = value;
		currentPage = 1;
		loadLeads();
	}

	function handlePageFilterChange(value: string) {
		pageFilter = value;
		currentPage = 1;
		loadLeads();
	}

	async function handleStatusChange(leadId: string, newStatus: string) {
		try {
			await updateLeadStatus({ leadId, status: newStatus as any });
			toast.success('Status actualizat');
			loadLeads();
		} catch (e) {
			toast.error('Eroare la actualizare status');
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold flex items-center gap-3">
				<IconFacebook class="h-7 w-7" />
				Facebook Ads Leads
			</h1>
			<p class="text-muted-foreground">Leaduri din campaniile Facebook & Instagram</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<DateRangePicker bind:since bind:until onchange={() => { currentPage = 1; loadLeads(); }} />
			{#if clientPages.length > 1}
				<select
					class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					value={pageFilter}
					onchange={(e) => { pageFilter = e.currentTarget.value; currentPage = 1; loadLeads(); }}
				>
					<option value="">Toate paginile</option>
					{#each clientPages as pg (pg.id)}
						<option value={pg.id}>{pg.pageName}</option>
					{/each}
				</select>
			{/if}
			<Button onclick={exportCSV} variant="outline" size="sm" disabled={leads.length === 0}>
				<DownloadIcon class="h-4 w-4" />
			</Button>
		</div>
	</div>

	<!-- Filters -->
	<div class="flex flex-col sm:flex-row gap-3 items-center">
		<div class="relative flex-1 max-w-sm">
			<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
			<Input
				placeholder="Caută după nume, email, telefon..."
				class="pl-9"
				value={search}
				oninput={handleSearchInput}
			/>
		</div>
		<Select.Root type="single" onValueChange={handleFilterChange}>
			<Select.Trigger class="w-[180px]">
				{statusOptions.find((o) => o.value === statusFilter)?.label || 'Status'}
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as opt (opt.value)}
					<Select.Item value={opt.value}>{opt.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if clientPages.length > 1}
			<Select.Root type="single" onValueChange={handlePageFilterChange}>
				<Select.Trigger class="w-[220px]">
					{clientPages.find((p: any) => p.id === pageFilter)?.pageName || 'Toate paginile'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="">Toate paginile</Select.Item>
					{#each clientPages as pg (pg.id)}
						<Select.Item value={pg.id}>{pg.pageName}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<div class="flex items-center gap-1 border rounded-md p-1 ml-auto">
			<Button
				variant={currentView === 'kanban' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => switchView('kanban')}
			>
				<LayoutGridIcon class="h-4 w-4 mr-1" />
				Kanban
			</Button>
			<Button
				variant={currentView === 'table' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => switchView('table')}
			>
				<TableIcon class="h-4 w-4 mr-1" />
				Table
			</Button>
		</div>
	</div>

	<!-- Content -->
	{#if currentView === 'kanban'}
		{#if loading && kanbanLeads.length === 0}
			<div class="flex items-center justify-center py-12">
				<RefreshCwIcon class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if kanbanLeads.length === 0 && !loading}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<ContactIcon class="h-12 w-12 text-muted-foreground mb-4" />
				<h3 class="text-lg font-semibold">Niciun lead găsit</h3>
				<p class="text-sm text-muted-foreground mt-1">
					{search || statusFilter || pageFilter ? 'Încearcă alte filtre' : 'Nu există leaduri importate încă'}
				</p>
			</div>
		{:else}
			<LeadKanbanBoard
				leads={kanbanLeads}
				readonly={false}
				{tenantSlug}
				onLeadClick={(lead) => goto(`/client/${tenantSlug}/leads/${lead.id}`)}
				onStatusChange={handleStatusChange}
			/>
		{/if}
	{:else if loading && leads.length === 0}
		<div class="flex items-center justify-center py-12">
			<RefreshCwIcon class="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	{:else if leads.length === 0 && !loading}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ContactIcon class="h-12 w-12 text-muted-foreground mb-4" />
			<h3 class="text-lg font-semibold">Niciun lead găsit</h3>
			<p class="text-sm text-muted-foreground mt-1">
				{search || statusFilter || pageFilter ? 'Încearcă alte filtre' : 'Nu există leaduri importate încă'}
			</p>
		</div>
	{:else}
		<div class="rounded-md border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Nume</Table.Head>
						<Table.Head>Email</Table.Head>
						<Table.Head>Telefon</Table.Head>
						<Table.Head>Formular</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Data și ora</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each leads as lead (lead.id)}
						<Table.Row
							class="cursor-pointer hover:bg-muted/50"
							onclick={() => goto(`/client/${tenantSlug}/leads/${lead.id}`)}
						>
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
					onchange={() => { currentPage = 1; loadLeads(); }}
				>
					<option value={10}>10 / pagină</option>
					<option value={25}>25 / pagină</option>
					<option value={50}>50 / pagină</option>
				</select>
			</div>
			{#if totalPages > 1}
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled={currentPage <= 1} onclick={() => { currentPage--; loadLeads(); }}>
						<ChevronLeftIcon class="h-4 w-4" />
					</Button>
					<span class="text-sm text-muted-foreground">Pagina {currentPage} / {totalPages}</span>
					<Button variant="outline" size="sm" disabled={currentPage >= totalPages} onclick={() => { currentPage++; loadLeads(); }}>
						<ChevronRightIcon class="h-4 w-4" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
