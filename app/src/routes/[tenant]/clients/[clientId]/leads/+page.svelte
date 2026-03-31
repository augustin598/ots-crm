<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import { getLeads, updateLeadStatus } from '$lib/remotes/leads.remote';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	let search = $state('');
	let statusFilter = $state('');
	let currentPage = $state(1);
	let pageSize = $state(25);

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

	const platformIcons: Record<string, string> = {
		facebook: 'FB',
		google: 'GA',
		tiktok: 'TT'
	};

	const filterParams = $derived({
		clientId,
		status: statusFilter || undefined,
		search: search || undefined,
		limit: pageSize,
		offset: (currentPage - 1) * pageSize
	});

	const leadsQuery = $derived(getLeads(filterParams));
	const leadsData = $derived(leadsQuery.current || { rows: [], totalCount: 0 });
	const leads = $derived(leadsData.rows);
	const totalCount = $derived(leadsData.totalCount);
	const loading = $derived(leadsQuery.loading);
	const totalPages = $derived(Math.ceil(totalCount / pageSize));

	$effect(() => {
		// Reset page when filters change
		search;
		statusFilter;
		currentPage = 1;
	});

	async function handleStatusChange(leadId: string, newStatus: string) {
		try {
			await updateLeadStatus({ leadId, status: newStatus as any });
			toast.success('Status actualizat');
			leadsQuery.refetch();
		} catch (e) {
			toast.error('Eroare la actualizare status');
		}
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	let debounceTimer: ReturnType<typeof setTimeout>;
	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => { search = val; }, 300);
	}
</script>

<div class="space-y-6">
	<!-- Filters -->
	<div class="flex flex-col sm:flex-row gap-3">
		<div class="relative flex-1 max-w-sm">
			<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
			<Input
				placeholder="Caută după nume, email, telefon..."
				class="pl-9"
				value={search}
				oninput={handleSearchInput}
			/>
		</div>
		<Select.Root onValueChange={(val) => { statusFilter = val; }}>
			<Select.Trigger class="w-[180px]">
				{statusOptions.find((o) => o.value === statusFilter)?.label || 'Status'}
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as opt (opt.value)}
					<Select.Item value={opt.value}>{opt.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- Table -->
	{#if loading && leads.length === 0}
		<div class="flex items-center justify-center py-12">
			<RefreshCwIcon class="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	{:else if leads.length === 0 && !loading}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ContactIcon class="h-12 w-12 text-muted-foreground mb-4" />
			<h3 class="text-lg font-semibold">Niciun lead găsit</h3>
			<p class="text-sm text-muted-foreground mt-1">
				{search || statusFilter
					? 'Încearcă alte filtre'
					: 'Nu există leaduri asociate acestui client. Asociază o pagină Facebook din Setări → Meta Ads.'}
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
						<Table.Head>Platformă</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Data</Table.Head>
						<Table.Head class="w-[50px]"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each leads as lead (lead.id)}
						<Table.Row
							class="cursor-pointer hover:bg-muted/50"
							onclick={() => goto(`/${tenantSlug}/leads/${lead.id}`)}
						>
							<Table.Cell class="font-medium">{lead.fullName || '-'}</Table.Cell>
							<Table.Cell>{lead.email || '-'}</Table.Cell>
							<Table.Cell>{lead.phoneNumber || '-'}</Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground">{lead.formName || '-'}</Table.Cell>
							<Table.Cell>
								<span class="text-xs font-medium text-muted-foreground">{platformIcons[lead.platform] || lead.platform}</span>
							</Table.Cell>
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
					onchange={() => (currentPage = 1)}
				>
					<option value={10}>10 / pagină</option>
					<option value={25}>25 / pagină</option>
					<option value={50}>50 / pagină</option>
				</select>
			</div>
			{#if totalPages > 1}
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled={currentPage <= 1} onclick={() => (currentPage = currentPage - 1)}>
						<ChevronLeftIcon class="h-4 w-4" />
					</Button>
					<span class="text-sm text-muted-foreground">Pagina {currentPage} / {totalPages}</span>
					<Button variant="outline" size="sm" disabled={currentPage >= totalPages} onclick={() => (currentPage = currentPage + 1)}>
						<ChevronRightIcon class="h-4 w-4" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
