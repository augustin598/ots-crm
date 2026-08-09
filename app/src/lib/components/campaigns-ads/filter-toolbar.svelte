<script lang="ts">
	import IconDownload from '@lucide/svelte/icons/download';
	import IconRefreshCw from '@lucide/svelte/icons/refresh-cw';
	import IconSearch from '@lucide/svelte/icons/search';
	import type { CampaignFilters } from '$lib/utils/meta-campaigns';
	import ColumnManager from './column-manager.svelte';
	import DropdownChip from './dropdown-chip.svelte';

	interface Option {
		id: string;
		label: string;
	}

	interface Col {
		id: string;
		label: string;
		locked?: boolean;
	}

	interface Props {
		filters: CampaignFilters;
		onFilters: (f: CampaignFilters) => void;
		objectives: Option[];
		accounts: Option[];
		selectedAccountId: string | null;
		onSelectAccount: (id: string) => void;
		allCols: Col[];
		visibleCols: Set<string>;
		onToggleCol: (id: string) => void;
		onResetCols: () => void;
		onExport: () => void;
		onRefresh: () => void;
		refreshing: boolean;
	}

	let {
		filters,
		onFilters,
		objectives,
		accounts,
		selectedAccountId,
		onSelectAccount,
		allCols,
		visibleCols,
		onToggleCol,
		onResetCols,
		onExport,
		onRefresh,
		refreshing
	}: Props = $props();

	let searchEl: HTMLInputElement | undefined;

	export function focusSearch() {
		searchEl?.focus();
	}

	const STATUS_OPTIONS: Option[] = [
		{ id: '', label: 'Toate' },
		{ id: 'ACTIVE', label: 'Active' },
		{ id: 'PAUSED', label: 'Pauzate' },
		{ id: 'WITH_ISSUES', label: 'Cu probleme' },
		{ id: 'IN_PROCESS', label: 'În procesare' }
	];

	const objectiveOptions = $derived<Option[]>([
		{ id: '', label: 'Toate obiectivele' },
		...objectives
	]);

	const statusValue = $derived(
		filters.status ? (STATUS_OPTIONS.find((s) => s.id === filters.status)?.label ?? null) : null
	);
	const objectiveValue = $derived(
		filters.objective
			? (objectiveOptions.find((o) => o.id === filters.objective)?.label ?? filters.objective)
			: null
	);
	const accountValue = $derived(accounts.find((a) => a.id === selectedAccountId)?.label ?? null);
</script>

<div class="toolbar">
	<div class="search-input">
		<IconSearch />
		<input
			{@attach (el) => {
				searchEl = el;
				return () => (searchEl = undefined);
			}}
			placeholder="Caută campanie, ID…"
			value={filters.q}
			oninput={(e) => onFilters({ ...filters, q: e.currentTarget.value })}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					onFilters({ ...filters, q: '' });
					e.currentTarget.blur();
				}
			}}
		/>
		<span class="search-kbd">⌘K</span>
	</div>

	<DropdownChip
		label="Status"
		value={statusValue}
		options={STATUS_OPTIONS}
		onSelect={(o) => onFilters({ ...filters, status: o.id })}
	/>
	<DropdownChip
		label="Obiectiv"
		value={objectiveValue}
		options={objectiveOptions}
		onSelect={(o) => onFilters({ ...filters, objective: o.id })}
	/>
	<DropdownChip
		label="Cont"
		icon="wallet"
		value={accountValue}
		options={accounts}
		onSelect={(o) => onSelectAccount(o.id)}
	/>

	<div class="toolbar-spacer"></div>

	<ColumnManager all={allCols} visible={visibleCols} onToggle={onToggleCol} onReset={onResetCols} />
	<button
		type="button"
		class="btn ghost"
		title="Exportă rândurile filtrate în CSV"
		onclick={onExport}
	>
		<IconDownload /> Export
	</button>
	<button
		type="button"
		class="btn ghost"
		title="Actualizează datele din Meta"
		disabled={refreshing}
		onclick={onRefresh}
	>
		<span class={['refresh-ico', { spinning: refreshing }]}>
			<IconRefreshCw />
		</span>
		Actualizează
	</button>
</div>

<style>
	.refresh-ico {
		display: inline-flex;
		align-items: center;
	}
	.refresh-ico.spinning {
		animation: ca-spin 0.9s linear infinite;
	}
	@keyframes ca-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
