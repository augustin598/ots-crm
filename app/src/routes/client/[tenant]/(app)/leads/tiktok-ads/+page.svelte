<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import { getLeads } from '$lib/remotes/leads.remote';

	const tenantSlug = $derived(page.params.tenant as string);

	let leads = $state<any[]>([]);
	let loading = $state(true);
	let search = $state('');
	let statusFilter = $state('');

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

	$effect(() => {
		loadLeads();
	});

	async function loadLeads() {
		loading = true;
		try {
			const result = await getLeads({
				platform: 'tiktok',
				status: statusFilter || undefined,
				search: search || undefined
			});
			leads = result.rows;
		} catch (e) {
			console.error('Failed to load leads:', e);
		} finally {
			loading = false;
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
		search = val;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => loadLeads(), 300);
	}

	function handleFilterChange(value: string) {
		statusFilter = value;
		loadLeads();
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold flex items-center gap-3">
				<IconTiktok class="h-7 w-7" />
				TikTok Ads Leads
			</h1>
			<p class="text-muted-foreground">Leaduri din campaniile TikTok</p>
		</div>
		<Badge variant="outline">Coming Soon</Badge>
	</div>

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
		<Select.Root onValueChange={handleFilterChange}>
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
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<RefreshCwIcon class="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	{:else if leads.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ContactIcon class="h-12 w-12 text-muted-foreground mb-4" />
			<h3 class="text-lg font-semibold">Niciun lead găsit</h3>
			<p class="text-sm text-muted-foreground mt-1">
				Integrarea TikTok Ads Leads va fi disponibilă în curând.
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
						<Table.Head>Data</Table.Head>
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
		<p class="text-sm text-muted-foreground">{leads.length} leaduri afișate</p>
	{/if}
</div>
