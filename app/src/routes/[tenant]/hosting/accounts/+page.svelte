<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		getHostingAccountsGrouped,
		updateHostingAccountClient,
		syncAllHostingAccounts,
		type ClientGroup
	} from '$lib/remotes/hosting-accounts.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import ColumnManager from '$lib/components/hosting/column-manager.svelte';
	import ClientGroupCard from '$lib/components/hosting/client-group-card.svelte';
	import {
		loadPersistedColumnConfig,
		savePersistedColumnConfig,
		buildDefaultConfig,
		visibleColumnsInOrder,
		type ColumnConfig
	} from '$lib/components/hosting/column-manager';
	import {
		HOSTING_ACCOUNT_COLUMNS,
		COLUMNS_STORAGE_KEY
	} from '$lib/components/hosting/columns.default';
	import { formatRON } from '$lib/components/hosting/hosting-format';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import XIcon from '@lucide/svelte/icons/x';

	const tenantSlug = $derived(page.params.tenant ?? '');
	let statusFilter = $state('');
	let clientSearch = $state('');
	let showOnlyUnassigned = $state(false);
	let columnDrawerOpen = $state(false);

	const DEFAULT_CONFIG = buildDefaultConfig(HOSTING_ACCOUNT_COLUMNS);
	let columnConfig = $state<ColumnConfig>(
		loadPersistedColumnConfig(COLUMNS_STORAGE_KEY, DEFAULT_CONFIG)
	);

	$effect(() => {
		savePersistedColumnConfig(COLUMNS_STORAGE_KEY, columnConfig);
	});

	const visibleColumns = $derived(visibleColumnsInOrder(HOSTING_ACCOUNT_COLUMNS, columnConfig));

	function fetchGroups() {
		return getHostingAccountsGrouped({ status: statusFilter || undefined, limit: 500 });
	}
	let groups = $state(fetchGroups());
	const allClients = getClients();

	function refresh(): void {
		groups = fetchGroups();
	}

	function filterGroups(items: ClientGroup[], q: string, onlyUnassigned: boolean): ClientGroup[] {
		let out = items;
		if (onlyUnassigned) out = out.filter((g) => !g.clientId);
		const query = q.trim().toLowerCase();
		if (!query) return out;
		return out
			.map((g) => ({
				...g,
				accounts: g.accounts.filter(
					(a) =>
						(g.client.name ?? '').toLowerCase().includes(query) ||
						(g.client.businessName ?? '').toLowerCase().includes(query) ||
						(g.client.email ?? '').toLowerCase().includes(query) ||
						(g.client.cui ?? '').toLowerCase().includes(query) ||
						(a.domain ?? '').toLowerCase().includes(query) ||
						(a.daUsername ?? '').toLowerCase().includes(query)
				)
			}))
			.filter((g) => g.accounts.length > 0);
	}

	async function assignClient(accountId: string, newClientId: string | null): Promise<void> {
		try {
			await updateHostingAccountClient({ accountId, clientId: newClientId });
			toast.success(newClientId ? 'Client asignat' : 'Asignare ștearsă');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare asignare');
		}
	}

	let bulkSyncing = $state(false);

	async function bulkSync(): Promise<void> {
		if (bulkSyncing) return;
		bulkSyncing = true;
		const toastId = toast.loading(
			'Se sincronizează toate conturile din DA... (poate dura ~10-30 sec)'
		);
		try {
			const result = await syncAllHostingAccounts({});
			const msg =
				result.failed === 0
					? `${result.synced}/${result.total} conturi sincronizate · pachete + domenii addon din DA`
					: `${result.synced}/${result.total} OK · ${result.failed} eșuate (vezi consola)`;
			if (result.failed > 0) {
				console.warn('[bulk-sync] errors:', result.errors);
				toast.warning(msg, { id: toastId, duration: 8000 });
			} else {
				toast.success(msg, { id: toastId, duration: 5000 });
			}
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare bulk sync', { id: toastId });
		} finally {
			bulkSyncing = false;
		}
	}

	type ClientLite = { id: string; name: string; email: string | null; cui: string | null };
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold">Conturi Hosting</h1>
			<p class="text-slate-500">
				Grupate după client cu vizibilitate la sănătatea relației: LTV, MRR, scadențe, facturi
				restante. Apasă <strong>Coloane</strong> ca să configurezi vizibilitatea coloanelor.
			</p>
		</div>
		<div class="flex shrink-0 gap-2">
			<button
				type="button"
				onclick={() => (columnDrawerOpen = true)}
				class="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
			>
				<SlidersHorizontalIcon class="size-4" /> Coloane
			</button>
			<button
				type="button"
				onclick={bulkSync}
				disabled={bulkSyncing}
				class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
				title="Sincronizează din DA: pachet, domenii addon, disk, bandwidth, etc."
			>
				<RefreshCwIcon class="size-4 {bulkSyncing ? 'animate-spin' : ''}" />
				{bulkSyncing ? 'Se sincronizează…' : 'Sync toate (din DA)'}
			</button>
			<a
				href={`/${tenantSlug}/hosting/accounts/new`}
				class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				<PlusIcon class="size-4" /> Cont nou
			</a>
		</div>
	</div>

	{#await groups}
		<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:bg-slate-800">
			Se încarcă conturile…
		</div>
	{:then items}
		{@const allGroups = items as ClientGroup[]}
		{@const filtered = filterGroups(allGroups, clientSearch, showOnlyUnassigned)}
		{@const totalAccounts = filtered.reduce((s, g) => s + g.accounts.length, 0)}
		{@const activeAccounts = filtered.reduce(
			(s, g) => s + (g.totals.byStatus.active ?? 0),
			0
		)}
		{@const totalMRR = filtered.reduce((s, g) => s + g.totals.mrrCents, 0)}
		{@const vipCount = filtered.filter((g) => g.client.tier === 'vip').length}
		{@const overdueGroups = filtered.filter((g) => g.totals.overdueCount > 0).length}
		{@const unassignedCount = allGroups.find((g) => !g.clientId)?.accounts.length ?? 0}

		<div class="grid grid-cols-2 gap-4 md:grid-cols-7">
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Clienți</div>
				<div class="mt-1 text-2xl font-bold">
					{filtered.filter((g) => g.clientId).length}
				</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Conturi</div>
				<div class="mt-1 text-2xl font-bold">{totalAccounts}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Active</div>
				<div class="mt-1 text-2xl font-bold text-green-700">{activeAccounts}</div>
			</div>
			<button
				type="button"
				onclick={() => (showOnlyUnassigned = !showOnlyUnassigned)}
				class="rounded-xl border bg-white p-4 text-left dark:bg-slate-800 {unassignedCount > 0
					? 'border-red-200 hover:border-red-300'
					: ''} {showOnlyUnassigned ? 'ring-2 ring-red-400' : ''}"
			>
				<div
					class="text-xs uppercase {unassignedCount > 0 ? 'text-red-700' : 'text-slate-500'}"
				>
					Neasignate{unassignedCount > 0 ? ' (filtru)' : ''}
				</div>
				<div class="mt-1 text-2xl font-bold {unassignedCount > 0 ? 'text-red-700' : ''}">
					{unassignedCount}
				</div>
			</button>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">VIP</div>
				<div class="mt-1 text-2xl font-bold text-amber-700">{vipCount}</div>
			</div>
			<div
				class="rounded-xl border bg-white p-4 dark:bg-slate-800"
				title="Monthly Recurring Revenue: suma normalizată la o lună din toate conturile active."
			>
				<div class="text-xs uppercase text-slate-500">MRR</div>
				<div class="mt-1 text-2xl font-bold">{formatRON(totalMRR)}</div>
			</div>
			<div
				class="rounded-xl border p-4 {overdueGroups > 0
					? 'border-red-200 bg-red-50 dark:bg-red-950'
					: 'bg-white dark:bg-slate-800'}"
			>
				<div class="text-xs uppercase {overdueGroups > 0 ? 'text-red-700' : 'text-slate-500'}">
					Restanți
				</div>
				<div class="mt-1 text-2xl font-bold {overdueGroups > 0 ? 'text-red-700' : ''}">
					{overdueGroups}
				</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative">
				<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					placeholder="Caută după client, email, domeniu sau username..."
					bind:value={clientSearch}
					class="w-80 rounded-lg border py-2 pl-10 pr-3 text-sm dark:bg-slate-800"
				/>
			</div>
			<select
				bind:value={statusFilter}
				onchange={refresh}
				class="rounded-lg border px-3 py-2 text-sm dark:bg-slate-800"
			>
				<option value="">Toate statusurile</option>
				<option value="active">Active</option>
				<option value="suspended">Suspendate</option>
				<option value="pending">În așteptare</option>
				<option value="terminated">Terminate</option>
				<option value="cancelled">Anulate</option>
			</select>
		</div>

		{#await allClients then clients}
			{@const clientList = clients as ClientLite[]}
			{@const clientOptions = [
				{ value: '', label: '— Neasignat —' },
				...clientList.map((c) => ({
					value: c.id,
					label: `${c.name}${c.cui ? ` · CUI ${c.cui}` : ''}${c.email ? ` · ${c.email}` : ''}`
				}))
			] satisfies Option[]}

			{#if filtered.length === 0}
				<div
					class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:bg-slate-800"
				>
					{clientSearch || showOnlyUnassigned
						? 'Niciun rezultat pentru filtru.'
						: 'Niciun cont hosting.'}
				</div>
			{:else}
				<div class="space-y-4">
					{#each filtered as g (g.clientId ?? '__unassigned__')}
						<ClientGroupCard
							group={g}
							{visibleColumns}
							{tenantSlug}
							{clientOptions}
							onassignClient={assignClient}
						/>
					{/each}
				</div>
			{/if}
		{/await}
	{/await}
</div>

{#if columnDrawerOpen}
	<button
		type="button"
		aria-label="Închide"
		class="fixed inset-0 z-40 bg-black/40"
		onclick={() => (columnDrawerOpen = false)}
	></button>
	<div
		class="fixed right-0 top-0 z-50 flex h-full w-96 flex-col gap-3 overflow-y-auto border-l bg-white p-5 shadow-xl dark:bg-slate-900"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold">Configurare coloane</h2>
			<button
				type="button"
				onclick={() => (columnDrawerOpen = false)}
				aria-label="Închide"
				class="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
			>
				<XIcon class="size-4" />
			</button>
		</div>
		<p class="text-xs text-slate-500">
			Trage rândurile pentru a schimba ordinea. Apasă comutatorul pentru a ascunde / arăta.
			Coloanele marcate <strong>REQUIRED</strong> sunt blocate.
		</p>
		<ColumnManager
			columns={HOSTING_ACCOUNT_COLUMNS}
			value={columnConfig}
			onchange={(next) => (columnConfig = next)}
		/>
		<div class="mt-2 flex justify-between text-xs">
			<button
				type="button"
				onclick={() => (columnConfig = buildDefaultConfig(HOSTING_ACCOUNT_COLUMNS))}
				class="text-blue-600 hover:underline"
			>
				Resetează la default
			</button>
			<span class="text-slate-400">Salvat local</span>
		</div>
	</div>
{/if}
