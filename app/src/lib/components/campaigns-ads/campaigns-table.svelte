<script module lang="ts">
	export interface CampaignColumn {
		id: string;
		label: string;
		locked?: boolean;
		num?: boolean;
	}

	/** Coloanele tabelului (port campaign-list.jsx ALL_COLS). */
	export const ALL_COLS: CampaignColumn[] = [
		{ id: 'name', label: 'Campanie', locked: true },
		{ id: 'status', label: 'Status' },
		{ id: 'objective', label: 'Obiectiv' },
		{ id: 'budget', label: 'Buget', num: true },
		{ id: 'spent', label: 'Cheltuit', num: true },
		{ id: 'impressions', label: 'Impresii', num: true },
		{ id: 'clicks', label: 'Clicuri', num: true },
		{ id: 'ctr', label: 'CTR', num: true },
		{ id: 'conversions', label: 'Conversii', num: true },
		{ id: 'cpa', label: 'CPA', num: true },
		{ id: 'roas', label: 'ROAS', num: true },
		{ id: 'trend', label: 'Trend' }
	];

	/** Default fără „clicks” și „cpa”, ca în design. */
	export const DEFAULT_COLS: string[] = ALL_COLS.filter(
		(c) => c.id !== 'clicks' && c.id !== 'cpa'
	).map((c) => c.id);

	/** Cheia de sortare din CampaignRow pentru fiecare coloană. */
	const SORT_KEYS: Record<string, string> = { budget: 'dailyBudget', spent: 'spend' };
	const sortKeyOf = (colId: string) => SORT_KEYS[colId] ?? colId;
</script>

<script lang="ts">
	import IconChevronDown from '@lucide/svelte/icons/chevron-down';
	import IconChevronRight from '@lucide/svelte/icons/chevron-right';
	import IconEye from '@lucide/svelte/icons/eye';
	import IconPause from '@lucide/svelte/icons/pause';
	import IconPlay from '@lucide/svelte/icons/play';
	import IconMegaphone from '@lucide/svelte/icons/megaphone';
	import IconTriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import IconDollarSign from '@lucide/svelte/icons/dollar-sign';
	import IconTrendingDown from '@lucide/svelte/icons/trending-down';
	import IconZap from '@lucide/svelte/icons/zap';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import StatusBadge from './status-badge.svelte';
	import PacingBar from './pacing-bar.svelte';
	import MiniBars from './mini-bars.svelte';
	import CampaignDetailRow from './campaign-detail-row.svelte';
	import {
		fmtMoney,
		fmtNum,
		fmtPct,
		insightHitsFor,
		objectiveLabel,
		type CampaignRow,
		type SortState
	} from '$lib/utils/meta-campaigns';

	interface Props {
		/** Rândurile paginii curente. */
		rows: CampaignRow[];
		cols: Set<string>;
		/** Toate rândurile filtrate (pentru tfoot); null = fără rând de totaluri. */
		totalsRows: CampaignRow[] | null;
		currency: string;
		periodDays: number;
		selected: Set<string>;
		expandedId: string | null;
		sort: SortState;
		adAccountId: string;
		tenantSlug: string;
		busyIds: Set<string>;
		onSort: (key: string) => void;
		onSelect: (id: string) => void;
		onSelectAll: (all: boolean) => void;
		onExpand: (id: string) => void;
		onToggleStatus: (row: CampaignRow) => void;
	}

	let {
		rows,
		cols,
		totalsRows,
		currency,
		periodDays,
		selected,
		expandedId,
		sort,
		adAccountId,
		tenantSlug,
		busyIds,
		onSort,
		onSelect,
		onSelectAll,
		onExpand,
		onToggleStatus
	}: Props = $props();

	const FLAG_ICONS = {
		alert: IconTriangleAlert,
		dollar: IconDollarSign,
		trending: IconTrendingDown,
		zap: IconZap
	} as const;

	const headers = $derived(ALL_COLS.filter((h) => cols.has(h.id)));
	const span = $derived(cols.size + 3);
	const allSelected = $derived(rows.length > 0 && rows.every((c) => selected.has(c.id)));
	const someSelected = $derived(!allSelected && rows.some((c) => selected.has(c.id)));

	const totals = $derived.by(() => {
		if (!totalsRows || totalsRows.length === 0) return null;
		const sum = (fn: (c: CampaignRow) => number) => totalsRows.reduce((s, c) => s + fn(c), 0);
		const spent = sum((c) => c.spend);
		const imp = sum((c) => c.impressions);
		const clk = sum((c) => c.clicks);
		const conv = sum((c) => c.conversions);
		return {
			count: totalsRows.length,
			budget: sum((c) => c.dailyBudget ?? 0),
			spent,
			imp,
			clk,
			conv,
			ctr: imp > 0 ? (clk / imp) * 100 : 0,
			cpa: conv > 0 ? spent / conv : 0,
			// rândurile au conversionValue — îl folosim direct, nu spent×roas
			roas: spent > 0 ? sum((c) => c.conversionValue) / spent : 0
		};
	});

	const toggleDisabled = (c: CampaignRow) =>
		c.status === 'IN_PROCESS' || c.status === 'UNKNOWN' || busyIds.has(c.id);

	function onSwitchChange(e: Event, c: CampaignRow) {
		// Nu comutăm optimist: starea reală vine după confirmare + refetch.
		const input = e.currentTarget as HTMLInputElement;
		input.checked = c.status === 'ACTIVE';
		onToggleStatus(c);
	}

	function openPreview(c: CampaignRow) {
		if (c.previewUrl) window.open(c.previewUrl, '_blank');
	}
</script>

<div class="table-wrap">
	<table class="table">
		<thead>
			<tr>
				<th class="w-check">
					<input
						type="checkbox"
						class="checkbox"
						checked={allSelected}
						indeterminate={someSelected}
						aria-label="Selectează toate campaniile"
						onchange={() => onSelectAll(!allSelected)}
					/>
				</th>
				<th class="w-check"></th>
				{#each headers as h (h.id)}
					{#if h.id === 'trend'}
						<th>{h.label}</th>
					{:else}
						<th
							class={['sortable', sort.key === sortKeyOf(h.id) && 'sorted']}
							title={`Sortează după ${h.label}`}
							onclick={() => onSort(sortKeyOf(h.id))}
						>
							{h.label}
							{#if sort.key === sortKeyOf(h.id)}
								<span class="sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span>
							{:else}
								<span class="sort-arrow">↕</span>
							{/if}
						</th>
					{/if}
				{/each}
				<th class="w-actions"></th>
			</tr>
		</thead>
		<tbody>
			{#if rows.length === 0}
				<tr>
					<td colspan={span}>
						<div class="empty">
							<IconMegaphone class="empty-icon" />
							<div class="empty-title">Nicio campanie găsită</div>
							<div>Încearcă să modifici filtrele sau perioada.</div>
						</div>
					</td>
				</tr>
			{:else}
				{#each rows as c (c.id)}
					{@const hits = insightHitsFor(c, periodDays)}
					<tr class={[selected.has(c.id) && 'selected', expandedId === c.id && 'expanded']}>
						<td class="w-check">
							<input
								type="checkbox"
								class="checkbox"
								checked={selected.has(c.id)}
								aria-label={`Selectează ${c.name}`}
								onchange={() => onSelect(c.id)}
							/>
						</td>
						<td class="w-check">
							<button
								class="row-action expand-btn"
								title={expandedId === c.id ? 'Restrânge detaliile' : 'Extinde detaliile'}
								onclick={() => onExpand(c.id)}
							>
								{#if expandedId === c.id}<IconChevronDown />{:else}<IconChevronRight />{/if}
							</button>
						</td>
						<td>
							<div class="campaign-cell">
								<div class="campaign-icon"><IconFacebook /></div>
								<div class="campaign-text">
									<div class="campaign-name">
										{c.name}
										{#if hits.length > 0}
											<span class="row-flags">
												{#each hits as hit (hit.id)}
													{@const FlagIcon = FLAG_ICONS[hit.icon]}
													<span class={['row-flag', hit.tone]} title={`${hit.label} — ${hit.hint}`}>
														<FlagIcon />
													</span>
												{/each}
											</span>
										{/if}
									</div>
									<div class="campaign-meta">
										<span>{c.id}</span>
										<span class="dot-sep"></span>
										<span>{c.resultType}</span>
									</div>
								</div>
							</div>
						</td>
						{#if cols.has('status')}
							<td>
								<label class="switch sm status-switch">
									<input
										type="checkbox"
										checked={c.status === 'ACTIVE'}
										disabled={toggleDisabled(c)}
										onchange={(e) => onSwitchChange(e, c)}
									/>
									<span class="switch-slider"></span>
								</label>
								<StatusBadge status={c.status} />
							</td>
						{/if}
						{#if cols.has('objective')}
							<td class="tight"><span class="badge muted">{objectiveLabel(c.objective)}</span></td>
						{/if}
						{#if cols.has('budget')}
							<td class="num tight">
								{#if c.dailyBudget}
									{fmtMoney(c.dailyBudget, currency)}/<span class="unit">zi</span>
								{:else if c.lifetimeBudget}
									{fmtMoney(c.lifetimeBudget, currency)} <span class="unit">total</span>
								{:else}
									<span title={c.budgetSource === 'adset' ? 'Buget setat pe ad set' : undefined}>—</span>
								{/if}
							</td>
						{/if}
						{#if cols.has('spent')}
							<td class="num tight">
								{fmtMoney(c.spend, currency)}
								<PacingBar spend={c.spend} dailyBudget={c.dailyBudget} {periodDays} {currency} />
							</td>
						{/if}
						{#if cols.has('impressions')}
							<td class="num tight">{fmtNum(c.impressions)}</td>
						{/if}
						{#if cols.has('clicks')}
							<td class="num tight">{fmtNum(c.clicks)}</td>
						{/if}
						{#if cols.has('ctr')}
							<td class="num tight">{fmtPct(c.ctr)}</td>
						{/if}
						{#if cols.has('conversions')}
							<td class="num tight" title={c.cpaLabel}>
								{#if c.conversions > 0}
									<strong>{c.conversions}</strong>
									{#if !cols.has('cpa')}
										<div class="sub-cpa">{fmtMoney(c.cpa, currency)} CPA</div>
									{/if}
								{:else}—{/if}
							</td>
						{/if}
						{#if cols.has('cpa')}
							<td class="num tight">{c.cpa > 0 ? fmtMoney(c.cpa, currency) : '—'}</td>
						{/if}
						{#if cols.has('roas')}
							<td class="num tight">
								{#if c.roas > 0}
									<span class={['badge', c.roas >= 3 ? 'success' : c.roas >= 1 ? 'warn' : 'danger']}>
										{c.roas.toFixed(1)}x
									</span>
								{:else}—{/if}
							</td>
						{/if}
						{#if cols.has('trend')}
							<td>
								<MiniBars
									data={c.spark.length > 0 && c.spark.some((v) => v > 0)
										? c.spark
										: [1, 1, 1, 1, 1, 1, 1, 1]}
									color={c.status === 'ACTIVE' ? '#10b981' : '#94a3b8'}
								/>
							</td>
						{/if}
						<td class="w-actions">
							<div class="row-actions">
								<button
									class="row-action"
									title="Vezi preview în Facebook"
									disabled={!c.previewUrl}
									onclick={() => openPreview(c)}
								>
									<IconEye />
								</button>
								<button
									class="row-action"
									title={c.status === 'ACTIVE' ? 'Pauză' : 'Pornește'}
									disabled={toggleDisabled(c)}
									onclick={() => onToggleStatus(c)}
								>
									{#if c.status === 'ACTIVE'}<IconPause />{:else}<IconPlay />{/if}
								</button>
							</div>
						</td>
					</tr>
					{#if expandedId === c.id}
						<CampaignDetailRow row={c} {adAccountId} {tenantSlug} {currency} {span} />
					{/if}
				{/each}
			{/if}
		</tbody>
		{#if rows.length > 0 && totals}
			<tfoot>
				<tr>
					<td colspan="3"><span class="tf-label">Total · {totals.count} campanii</span></td>
					{#if cols.has('status')}<td></td>{/if}
					{#if cols.has('objective')}<td></td>{/if}
					{#if cols.has('budget')}<td class="num">{fmtMoney(totals.budget, currency)}</td>{/if}
					{#if cols.has('spent')}<td class="num">{fmtMoney(totals.spent, currency)}</td>{/if}
					{#if cols.has('impressions')}<td class="num">{fmtNum(totals.imp)}</td>{/if}
					{#if cols.has('clicks')}<td class="num">{fmtNum(totals.clk)}</td>{/if}
					{#if cols.has('ctr')}<td class="num">{fmtPct(totals.ctr)}</td>{/if}
					{#if cols.has('conversions')}<td class="num">{totals.conv > 0 ? totals.conv : '—'}</td>{/if}
					{#if cols.has('cpa')}<td class="num">{fmtMoney(totals.cpa, currency)}</td>{/if}
					{#if cols.has('roas')}<td class="num">{totals.roas > 0 ? totals.roas.toFixed(1) + 'x' : '—'}</td>{/if}
					{#if cols.has('trend')}<td></td>{/if}
					<td></td>
				</tr>
			</tfoot>
		{/if}
	</table>
</div>

<style>
	.w-check {
		width: 40px;
	}
	.w-actions {
		width: 76px;
	}
	.expand-btn {
		opacity: 1;
	}
	.status-switch {
		vertical-align: middle;
		margin-right: 8px;
	}
	.campaign-text {
		min-width: 0;
	}
	.campaign-icon :global(svg) {
		width: 16px;
		height: 16px;
	}
	.unit {
		color: var(--ca-text-3);
	}
	.sub-cpa {
		font-size: 11px;
		color: var(--ca-text-3);
	}
	.empty-title {
		font-weight: 600;
		color: var(--ca-text);
	}
	.row-action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.row-action:disabled:hover {
		background: transparent;
		border-color: transparent;
		color: var(--ca-text-2);
	}
</style>
