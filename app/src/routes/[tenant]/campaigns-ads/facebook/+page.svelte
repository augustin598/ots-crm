<script lang="ts">
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { getReportAdAccounts } from '$lib/remotes/reports.remote';
	import {
		listMetaCampaignRows,
		toggleMetaCampaign,
		refreshMetaCampaigns
	} from '$lib/remotes/meta-campaigns.remote';
	import { getDefaultDateRange } from '$lib/utils/report-helpers';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import {
		computeKpis,
		filterCampaignRows,
		sortCampaignRows,
		buildCampaignsCsv,
		objectiveLabel,
		type CampaignFilters,
		type CampaignRow,
		type SortState
	} from '$lib/utils/meta-campaigns';
	import KpiCards from '$lib/components/campaigns-ads/kpi-cards.svelte';
	import InsightsStrip from '$lib/components/campaigns-ads/insights-strip.svelte';
	import FilterToolbar from '$lib/components/campaigns-ads/filter-toolbar.svelte';
	import ActiveFilters from '$lib/components/campaigns-ads/active-filters.svelte';
	import BulkBar from '$lib/components/campaigns-ads/bulk-bar.svelte';
	import CampaignsTable, {
		ALL_COLS,
		DEFAULT_COLS
	} from '$lib/components/campaigns-ads/campaigns-table.svelte';
	import Pagination from '$lib/components/campaigns-ads/pagination.svelte';
	import ConfirmDialog from '$lib/components/campaigns-ads/confirm-dialog.svelte';

	const tenantSlug = $derived(page.params.tenant as string);

	// ---- Perioadă ----
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	const periodDays = $derived.by(() => {
		const s = Date.parse(since + 'T00:00:00Z');
		const u = Date.parse(until + 'T00:00:00Z');
		if (!Number.isFinite(s) || !Number.isFinite(u) || u < s) return 0;
		return Math.round((u - s) / 86400000) + 1;
	});

	// ---- Conturi ----
	const accountsQuery = getReportAdAccounts();
	const accounts = $derived(accountsQuery.current || []);
	/** Contul ales explicit de user; gol = auto-select (URL sau primul din listă). */
	let chosenAccountId = $state('');
	const selectedAccountId = $derived.by(() => {
		if (chosenAccountId) return chosenAccountId;
		if (accounts.length === 0) return '';
		const urlAccount = page.url.searchParams.get('account');
		const match = urlAccount && accounts.find((a) => a.metaAdAccountId === urlAccount);
		return (match || accounts[0]).metaAdAccountId;
	});

	const selectedAccount = $derived(accounts.find((a) => a.metaAdAccountId === selectedAccountId));
	const currency = $derived(selectedAccount?.currency || 'RON');
	const accountLabel = $derived(
		selectedAccount
			? [selectedAccount.clientName, selectedAccount.accountName].filter(Boolean).join(' — ')
			: null
	);
	const accountOptions = $derived(
		accounts.map((a) => ({
			id: a.metaAdAccountId,
			label: [a.clientName, a.accountName].filter(Boolean).join(' — ') || a.metaAdAccountId
		}))
	);

	// ---- Avertizări cont (același pattern ca raportul FB) ----
	const paymentWarning = $derived.by(() => {
		const account = selectedAccount;
		if (!account) return null;
		if (account.disableReason === 3)
			return {
				level: 'error' as const,
				text: 'Contul Meta Ads a fost dezactivat din cauza problemelor de plată. Verifică metoda de plată în Business Manager.'
			};
		if (account.accountStatus === 3)
			return {
				level: 'error' as const,
				text: 'Contul Meta Ads are o factură neachitată (UNSETTLED). Reclamele pot fi oprite până la plată.'
			};
		if (account.accountStatus === 9)
			return {
				level: 'warning' as const,
				text: 'Contul Meta Ads e în perioadă de grație pentru plată. Achită factura pentru a evita oprirea reclamelor.'
			};
		return null;
	});
	const tokenWarning = $derived.by(() => {
		const account = selectedAccount;
		if (!account) return null;
		if (account.integrationActive === false)
			return 'Conexiunea Meta Ads pentru acest cont a fost dezactivată (token revocat/invalid). Reconectează din Settings.';
		if (account.isActive === false)
			return 'Acest cont Meta Ads este dezactivat. Verifică starea în Business Manager sau reconectează din Settings.';
		if (!account.tokenExpiresAt) return null;
		const expiresAt = new Date(account.tokenExpiresAt);
		const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);
		if (daysLeft < 0)
			return `Tokenul Meta Ads a expirat pe ${expiresAt.toLocaleDateString('ro-RO')}. Reconectează din Settings.`;
		if (daysLeft <= 7)
			return `Tokenul Meta Ads expiră în ${daysLeft} zile (${expiresAt.toLocaleDateString('ro-RO')}). Reconectează din Settings.`;
		return null;
	});

	// ---- Datele campaniilor ----
	// Derived scriibil: se re-creează la schimbarea contului/perioadei.
	// Comenzile împrospătează instanța live prin .updates()/.refresh() —
	// re-instanțierea cu aceleași argumente NU reface fetch-ul (memoizare per-args).
	let rowsQuery = $derived(
		selectedAccountId && since && until
			? listMetaCampaignRows({ adAccountId: selectedAccountId, since, until })
			: null
	);

	const allRows = $derived(rowsQuery?.current?.rows ?? []);
	const dailySpend = $derived(rowsQuery?.current?.dailySpend ?? []);
	const loading = $derived(rowsQuery?.loading ?? false);
	const loadError = $derived(rowsQuery?.error);

	// Doar pentru retry după EROARE: kit-ul evacuează instanțele eșuate din
	// cache-ul per-args, deci re-instanțierea aici chiar reface fetch-ul.
	function retryLoad() {
		if (selectedAccountId && since && until) {
			rowsQuery = listMetaCampaignRows({ adAccountId: selectedAccountId, since, until });
		}
	}

	// ---- Filtre, sortare, paginare, selecție ----
	let filters = $state<CampaignFilters>({ q: '', status: '', objective: '', insight: '' });
	let sort = $state<SortState>({ key: 'spend', dir: 'desc' });
	let pageNo = $state(1);
	let pageSize = $state(15);
	const visibleCols = new SvelteSet<string>(DEFAULT_COLS);
	const selected = new SvelteSet<string>();
	const busyIds = new SvelteSet<string>();
	let expandedId = $state<string | null>(null);
	let refreshing = $state(false);
	let bulkBusy = $state(false);
	let confirmState = $state<{
		title: string;
		body: string;
		confirmLabel: string;
		tone: 'danger' | 'primary';
		run: () => void;
	} | null>(null);

	const kpis = $derived(computeKpis(allRows, periodDays));
	// Sortăm ÎNAINTE de filtrare: tastarea în căutare declanșează doar filtrul O(n),
	// nu și re-sortarea (sort stabil + filtru care păstrează ordinea = același rezultat).
	const sorted = $derived(sortCampaignRows(allRows, sort));
	const filtered = $derived(filterCampaignRows(sorted, filters, periodDays));
	const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
	/** pageNo limitat când lista filtrată se micșorează sub pagina curentă. */
	const currentPage = $derived(Math.min(pageNo, totalPages));
	const paged = $derived(filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize));
	const objectives = $derived.by(() => {
		const seen: Record<string, string> = {};
		for (const r of allRows) {
			if (r.objective && !(r.objective in seen)) seen[r.objective] = objectiveLabel(r.objective);
		}
		// filter-toolbar adaugă singur intrarea „Toate obiectivele"
		return Object.entries(seen).map(([id, label]) => ({ id, label }));
	});

	function resetListState() {
		pageNo = 1;
		selected.clear();
		expandedId = null;
	}

	function setFilters(f: CampaignFilters) {
		filters = f;
		resetListState();
	}

	function pickStatus(s: string) {
		setFilters({ ...filters, status: filters.status === s ? '' : s });
	}

	function handleAccountChange(id: string) {
		chosenAccountId = id;
		setFilters({ q: '', status: '', objective: '', insight: '' });
	}

	function onSort(key: string) {
		sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
	}

	function onSelect(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function onSelectAll(all: boolean) {
		// Doar pagina curentă intră/iese din selecție — selecțiile de pe alte pagini rămân.
		if (all) for (const c of paged) selected.add(c.id);
		else for (const c of paged) selected.delete(c.id);
	}

	// ---- Acțiuni ----
	async function runToggle(row: CampaignRow, target: 'ACTIVE' | 'PAUSED') {
		busyIds.add(row.id);
		try {
			const cmd = toggleMetaCampaign({
				adAccountId: selectedAccountId,
				campaignId: row.id,
				status: target
			});
			// .updates(instanța live) reîmprospătează lista în același roundtrip.
			await (rowsQuery ? cmd.updates(rowsQuery) : cmd);
			if (target === 'ACTIVE') toast.success('Campanie pornită', { description: row.name });
			else toast.warning('Campanie pauzată', { description: row.name });
		} catch (e) {
			toast.error('Acțiunea a eșuat', { description: remoteErrorMessage(e, 'Încearcă din nou.') });
		} finally {
			busyIds.delete(row.id);
		}
	}

	function onToggleStatus(row: CampaignRow) {
		const target = row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
		confirmState = {
			title: target === 'PAUSED' ? 'Pauzezi campania?' : 'Pornești campania?',
			body: `„${row.name}" va fi ${target === 'PAUSED' ? 'pauzată' : 'pornită'} în Meta Ads.`,
			confirmLabel: target === 'PAUSED' ? 'Pauzează' : 'Pornește',
			tone: target === 'PAUSED' ? 'danger' : 'primary',
			run: () => void runToggle(row, target)
		};
	}

	function onBulk(kind: 'activate' | 'pause') {
		const ids = [...selected];
		const target = kind === 'pause' ? 'PAUSED' : 'ACTIVE';
		confirmState = {
			title: kind === 'pause' ? `Pauzezi ${ids.length} campanii?` : `Pornești ${ids.length} campanii?`,
			body: 'Acțiunea se aplică în Meta Ads pentru toate campaniile selectate.',
			confirmLabel: kind === 'pause' ? 'Pauzează tot' : 'Pornește tot',
			tone: kind === 'pause' ? 'danger' : 'primary',
			run: async () => {
				bulkBusy = true;
				let ok = 0;
				let failed = 0;
				for (const id of ids) {
					try {
						await toggleMetaCampaign({ adAccountId: selectedAccountId, campaignId: id, status: target });
						ok++;
					} catch {
						failed++;
					}
				}
				// Un singur refresh la final, nu N (comenzile din buclă nu au .updates()).
				await rowsQuery?.refresh();
				bulkBusy = false;
				selected.clear();
				const verb = target === 'ACTIVE' ? 'pornite' : 'pauzate';
				if (failed === 0) toast.success(`${ok} campanii ${verb}`);
				else toast.warning(`${ok} campanii ${verb}, ${failed} eșuate`);
			}
		};
	}

	function exportCsv() {
		const csv = buildCampaignsCsv(filtered, currency);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'campanii-meta.csv';
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		toast.success('Export CSV generat', {
			description: `${filtered.length} campanii (exact ce e filtrat acum).`
		});
	}

	async function refresh() {
		if (!selectedAccountId) return;
		refreshing = true;
		try {
			// Golește cache-ul serverului, apoi reîmprospătează instanța live.
			await refreshMetaCampaigns({ adAccountId: selectedAccountId });
			await rowsQuery?.refresh();
		} catch (e) {
			toast.error('Refresh eșuat', { description: remoteErrorMessage(e, 'Încearcă din nou.') });
		} finally {
			refreshing = false;
		}
	}
</script>

<div class="fb-page">
	{#if paymentWarning}
		<div class={['banner', paymentWarning.level]}>{paymentWarning.text}</div>
	{/if}
	{#if tokenWarning}
		<div class="banner warning">{tokenWarning}</div>
	{/if}

	<KpiCards
		{kpis}
		{currency}
		{dailySpend}
		statusFilter={filters.status}
		onPickStatus={pickStatus}
	/>

	{#if !loadError}
		<InsightsStrip
			rows={allRows}
			{periodDays}
			active={filters.insight}
			onPick={(id) => setFilters({ ...filters, insight: id })}
		/>
	{/if}

	<div class="toolbar-row">
		<FilterToolbar
			{filters}
			onFilters={setFilters}
			{objectives}
			accounts={accountOptions}
			{selectedAccountId}
			onSelectAccount={handleAccountChange}
			allCols={ALL_COLS}
			{visibleCols}
			onToggleCol={(id) => (visibleCols.has(id) ? visibleCols.delete(id) : visibleCols.add(id))}
			onResetCols={() => {
				visibleCols.clear();
				for (const c of DEFAULT_COLS) visibleCols.add(c);
			}}
			onExport={exportCsv}
			onRefresh={refresh}
			{refreshing}
		/>
		<DateRangePicker bind:since bind:until onchange={resetListState} />
	</div>

	<ActiveFilters
		{filters}
		{accountLabel}
		resultCount={filtered.length}
		total={allRows.length}
		onRemove={(key) => setFilters({ ...filters, [key]: '' })}
		onClearAll={() => setFilters({ q: '', status: '', objective: '', insight: '' })}
	/>

	{#if selected.size > 0}
		<BulkBar count={selected.size} busy={bulkBusy} onClear={() => selected.clear()} {onBulk} />
	{/if}

	{#if loadError}
		<div class="error-card">
			<p>{remoteErrorMessage(loadError, 'Nu s-au putut încărca campaniile Meta.')}</p>
			<button class="btn primary" onclick={retryLoad}>Încearcă din nou</button>
		</div>
	{:else if loading && allRows.length === 0}
		<div class="skeleton" aria-busy="true">
			{#each Array.from({ length: 6 }, (_, i) => i) as i (i)}
				<div class="skeleton-row"></div>
			{/each}
		</div>
	{:else}
		<CampaignsTable
			rows={paged}
			cols={visibleCols}
			totalsRows={filtered}
			{currency}
			{periodDays}
			{selected}
			{expandedId}
			{sort}
			adAccountId={selectedAccountId}
			{tenantSlug}
			{busyIds}
			{onSort}
			{onSelect}
			{onSelectAll}
			onExpand={(id) => (expandedId = expandedId === id ? null : id)}
			{onToggleStatus}
		/>

		<Pagination
			total={filtered.length}
			page={currentPage}
			{pageSize}
			onPage={(n) => (pageNo = n)}
			onPageSize={(n) => {
				pageSize = n;
				pageNo = 1;
			}}
		/>
	{/if}
</div>

{#if confirmState}
	{@const c = confirmState}
	<ConfirmDialog
		title={c.title}
		body={c.body}
		confirmLabel={c.confirmLabel}
		tone={c.tone}
		onConfirm={() => {
			confirmState = null;
			c.run();
		}}
		onCancel={() => (confirmState = null)}
	/>
{/if}

<style>
	.fb-page {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.toolbar-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		flex-wrap: wrap;
	}
	.toolbar-row > :global(:first-child) {
		flex: 1;
		min-width: 0;
	}
	.banner {
		border-radius: var(--ca-radius);
		padding: 10px 14px;
		font-size: 13px;
		border: 1px solid;
	}
	.banner.warning {
		background: var(--ca-warning-50);
		border-color: var(--ca-warning);
		color: #92400e;
	}
	.banner.error {
		background: var(--ca-danger-50);
		border-color: var(--ca-danger);
		color: #991b1b;
	}
	.error-card {
		background: var(--ca-surface);
		border: 1px solid var(--ca-danger);
		border-radius: var(--ca-radius);
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
		font-size: 13px;
		color: var(--ca-text-2);
	}
	.error-card p {
		margin: 0;
	}
	.skeleton {
		background: var(--ca-surface);
		border: 1px solid var(--ca-border);
		border-radius: var(--ca-radius);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.skeleton-row {
		height: 44px;
		border-radius: 8px;
		background: linear-gradient(90deg, var(--ca-surface-2) 25%, var(--ca-border) 50%, var(--ca-surface-2) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
	}
	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
