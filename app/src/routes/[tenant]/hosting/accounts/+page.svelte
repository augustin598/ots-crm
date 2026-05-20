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
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	const tenantSlug = $derived(page.params.tenant ?? '');
	let statusFilter = $state('');
	let clientSearch = $state('');
	let groupByClient = $state(true);
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
		const toastId = toast.loading('Se sincronizează toate conturile din DA...');
		try {
			const result = await syncAllHostingAccounts({});
			const msg =
				result.failed === 0
					? `${result.synced}/${result.total} conturi sincronizate`
					: `${result.synced}/${result.total} OK · ${result.failed} eșuate`;
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

	function exportCSV(items: ClientGroup[]): void {
		const rows: string[] = [];
		rows.push(
			[
				'client',
				'cui',
				'email',
				'da_user',
				'domain',
				'addon_domains',
				'package',
				'server',
				'billing_cycle',
				'auto_renew',
				'start_date',
				'next_due_date',
				'status',
				'amount_cents',
				'currency',
				'last_invoice_status',
				'last_invoice_date',
				'last_invoice_amount_cents'
			].join(',')
		);
		for (const g of items) {
			for (const a of g.accounts) {
				const cells = [
					g.client.name,
					g.client.cui ?? '',
					g.client.email ?? '',
					a.daUsername,
					a.domain,
					(a.additionalDomains ?? []).join('|'),
					a.daPackageName ?? a.linkedPackageName ?? '',
					a.serverName ?? '',
					a.billingCycle,
					a.autoRenew ? 'true' : 'false',
					a.startDate ?? '',
					a.nextDueDate ?? '',
					a.status,
					String(a.recurringAmount),
					a.currency,
					a.lastInvoice.status,
					a.lastInvoice.date ?? '',
					String(a.lastInvoice.amountCents)
				].map((v) => `"${String(v).replace(/"/g, '""')}"`);
				rows.push(cells.join(','));
			}
		}
		const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `conturi-hosting-${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	function exportConfig(): void {
		const cfg = { columns: columnConfig, exportedAt: new Date().toISOString() };
		const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'hosting-accounts-columns.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
</script>

<div class="space-y-5">
	<!-- Breadcrumb -->
	<nav class="flex items-center gap-2 text-sm text-slate-500" aria-label="breadcrumb">
		<a href={`/${tenantSlug}/hosting`} class="hover:text-slate-700 dark:hover:text-slate-300">Hosting</a>
		<span class="text-slate-300">›</span>
		<a href={`/${tenantSlug}/hosting/accounts`} class="hover:text-slate-700 dark:hover:text-slate-300">Conturi</a>
		<span class="text-slate-300">›</span>
		<span class="text-slate-700 dark:text-slate-200">Grupare după client</span>
	</nav>

	{#await groups}
		<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
			Se încarcă conturile…
		</div>
	{:then items}
		{@const allGroups = items as ClientGroup[]}
		{@const filtered = filterGroups(allGroups, clientSearch, showOnlyUnassigned)}
		{@const totalAccounts = filtered.reduce((s, g) => s + g.accounts.length, 0)}
		{@const totalClients = filtered.filter((g) => g.clientId).length}
		{@const totalAddons = filtered.reduce((s, g) => s + g.totals.addonCount, 0)}
		{@const activeAccounts = filtered.reduce((s, g) => s + (g.totals.byStatus.active ?? 0), 0)}
		{@const activePct = totalAccounts > 0 ? Math.round((activeAccounts / totalAccounts) * 100) : 0}
		{@const totalMRR = filtered.reduce((s, g) => s + g.totals.mrrCents, 0)}
		{@const totalARR = filtered.reduce((s, g) => s + g.totals.arrCents, 0)}
		{@const expiring30 = filtered.reduce((s, g) => s + (g.totals.nextExpiry && g.totals.nextExpiry.days <= 30 ? 1 : 0), 0)}
		{@const overdueInvoices = filtered.reduce((s, g) => s + g.totals.overdueCount, 0)}
		{@const unassignedCount = allGroups.find((g) => !g.clientId)?.accounts.length ?? 0}

		<!-- Title + actions -->
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-[22px] font-bold text-slate-900 dark:text-slate-100">Conturi hosting · grupare după client</h1>
				<p class="mt-0.5 text-sm text-slate-500">
					{totalClients} client{totalClients === 1 ? '' : 'i'} · {totalAccounts} cont{totalAccounts === 1 ? '' : 'uri'} · {totalAddons} domeni{totalAddons === 1 ? 'u' : 'i'} adițional{totalAddons === 1 ? '' : 'e'}
				</p>
			</div>
			<div class="flex shrink-0 gap-2">
				<button
					type="button"
					onclick={exportConfig}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				>
					<DownloadIcon class="size-4" /> Export config
				</button>
				<button
					type="button"
					onclick={() => exportCSV(filtered)}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				>
					<DownloadIcon class="size-4" /> Export CSV
				</button>
				<button
					type="button"
					onclick={bulkSync}
					disabled={bulkSyncing}
					class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
				>
					<RefreshCwIcon class="size-4 {bulkSyncing ? 'animate-spin' : ''}" />
					{bulkSyncing ? 'Sync…' : 'Sync DA'}
				</button>
				<a
					href={`/${tenantSlug}/hosting/accounts/new`}
					class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
				>
					<PlusIcon class="size-4" /> Cont nou
				</a>
			</div>
		</div>

		<!-- Info banner -->
		<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
			<span class="font-semibold">Ce e nou în acest design:</span> headerul de grup expune
			<em>sănătatea relației</em> (LTV, vechime, status mix, facturi restante, next renewal), nu doar
			identitatea. Coloanele noi:
			<code class="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900">Ciclu</code>
			(lunar/anual + auto-renew),
			<code class="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900">Ultima plată</code>
			(status factură),
			<code class="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900">+ domenii adiționale</code>
			ca chip vizibil în celula domeniului. Marginea colorată din stânga grupului semnalizează rapid:
			<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-500"></span> OK</span> ·
			<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-amber-500"></span> VIP / atenție scadență</span> ·
			<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-red-500"></span> risc (restant / suspendat)</span>.
		</div>

		<!-- KPI tiles -->
		<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
			<div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
				<div class="text-[10px] font-medium uppercase tracking-wider text-slate-500">Clienți</div>
				<div class="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{totalClients}</div>
				<div class="text-[11px] text-slate-500">cu hosting activ</div>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
				<div class="text-[10px] font-medium uppercase tracking-wider text-slate-500">Conturi</div>
				<div class="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{totalAccounts}</div>
				<div class="text-[11px] text-slate-500">{totalAddons} addons</div>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
				<div class="text-[10px] font-medium uppercase tracking-wider text-slate-500">Active</div>
				<div class="mt-1 text-2xl font-bold text-emerald-600">{activeAccounts}</div>
				<div class="text-[11px] text-slate-500">{activePct}% din total</div>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
				<div class="text-[10px] font-medium uppercase tracking-wider text-slate-500">Expiră 30z</div>
				<div class="mt-1 text-2xl font-bold text-amber-600">{expiring30}</div>
				<div class="text-[11px] text-slate-500">acțiune necesară</div>
			</div>
			<button
				type="button"
				onclick={() => (showOnlyUnassigned = !showOnlyUnassigned)}
				class="rounded-xl border bg-white p-4 text-left dark:bg-slate-800 {overdueInvoices > 0
					? 'border-red-200 dark:border-red-800'
					: 'border-slate-200 dark:border-slate-700'}"
			>
				<div class="text-[10px] font-medium uppercase tracking-wider {overdueInvoices > 0 ? 'text-red-700' : 'text-slate-500'}">
					Facturi restante
				</div>
				<div class="mt-1 text-2xl font-bold {overdueInvoices > 0 ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'}">
					{overdueInvoices}
				</div>
				<div class="text-[11px] text-slate-500">{overdueInvoices > 0 ? 'follow-up urgent' : 'totul OK'}</div>
			</button>
			<div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
				<div class="text-[10px] font-medium uppercase tracking-wider text-slate-500">MRR / ARR</div>
				<div class="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{formatRON(totalMRR)}<span class="text-xs font-normal text-slate-500">/lună</span></div>
				<div class="text-[11px] text-slate-500">{formatRON(totalARR)}/an</div>
			</div>
		</div>

		<!-- Toolbar -->
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative">
					<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						placeholder="Caută după client, domeniu, user…"
						bind:value={clientSearch}
						class="w-72 rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
					/>
				</div>
				<button
					type="button"
					onclick={() => (groupByClient = !groupByClient)}
					class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium {groupByClient
						? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
						: 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}"
				>
					<span class="flex size-4 items-center justify-center rounded {groupByClient ? 'bg-emerald-500 text-white' : 'border border-slate-300'}">
						{#if groupByClient}<CheckIcon class="size-3" />{/if}
					</span>
					Grupează după client
				</button>
				<select
					bind:value={statusFilter}
					onchange={refresh}
					class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
				>
					<option value="">Toate statusurile</option>
					<option value="active">Active</option>
					<option value="suspended">Suspendate</option>
					<option value="pending">În așteptare</option>
					<option value="terminated">Terminate</option>
					<option value="cancelled">Anulate</option>
				</select>
				<button
					type="button"
					onclick={() => (columnDrawerOpen = true)}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
				>
					<SlidersHorizontalIcon class="size-4" /> Coloane
				</button>
			</div>
			<div class="flex items-center gap-3 text-[11px]">
				<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-500"></span> active</span>
				<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-amber-400"></span> expiră</span>
				<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-orange-500"></span> suspendat</span>
				<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-slate-400"></span> terminat</span>
			</div>
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
				<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
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
