<script lang="ts">
	import type { Accent, KpiData } from './types';
	import { fmtRON, fmtNum, fmtPct } from './format';
	import Sparkline from './sparkline.svelte';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import UsersIcon from '@lucide/svelte/icons/users';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import BarChartIcon from '@lucide/svelte/icons/chart-column';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';

	let { kpi }: { kpi: KpiData } = $props();

	const ICONS: Record<string, typeof DollarSignIcon> = {
		DollarSign: DollarSignIcon,
		Users: UsersIcon,
		Folder: FolderIcon,
		CreditCard: CreditCardIcon,
		UserPlus: UserPlusIcon,
		Zap: ZapIcon
	};
	const ACCENT_VAR: Record<Accent, string> = {
		success: 'var(--d-success)',
		primary: 'var(--d-primary)',
		info: 'var(--d-info)',
		warn: 'var(--d-warn)',
		danger: 'var(--d-danger)'
	};

	const Icon = $derived(ICONS[kpi.icon] ?? BarChartIcon);
	const display = $derived(kpi.fmt === 'ron' ? fmtRON(kpi.value) : fmtNum(kpi.value));
	const up = $derived(kpi.delta >= 0);
</script>

<a href={kpi.href} class="dash-kpi" style:--accent={ACCENT_VAR[kpi.accent]}>
	<div class="dash-kpi-head">
		<div class="dash-kpi-icon"><Icon size={14} /></div>
		<div class="dash-kpi-label">{kpi.label}</div>
	</div>
	<div class="dash-kpi-value">{display}</div>
	<div class="dash-kpi-foot">
		<span class="dash-delta" class:up class:down={!up}>
			{#if up}<TrendingUpIcon size={11} />{:else}<TrendingDownIcon size={11} />{/if}
			{fmtPct(kpi.delta)}
		</span>
		<span class="dash-kpi-sub">{kpi.sub ?? 'vs luna trecută'}</span>
		<Sparkline data={kpi.spark} color="var(--accent)" w={60} h={20} />
	</div>
</a>

<style>
	.dash-kpi {
		background: var(--d-card);
		border: 1px solid var(--d-border);
		border-radius: 10px;
		padding: 12px 14px;
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 6px;
		position: relative;
		overflow: hidden;
		transition:
			border-color 0.15s,
			transform 0.15s,
			box-shadow 0.15s;
	}
	.dash-kpi:hover {
		border-color: var(--accent);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgb(15 23 42 / 0.06);
	}
	.dash-kpi::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: var(--accent);
	}
	.dash-kpi-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dash-kpi-icon {
		width: 22px;
		height: 22px;
		border-radius: 5px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		color: var(--accent);
		background: color-mix(in oklch, var(--accent) 14%, transparent);
	}
	.dash-kpi-label {
		font-size: 11px;
		color: var(--d-muted);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		line-height: 1.2;
	}
	.dash-kpi-value {
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1;
		color: var(--d-text);
	}
	.dash-kpi-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}
	.dash-delta {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.dash-delta.up {
		color: var(--d-success);
	}
	.dash-delta.down {
		color: var(--d-danger);
	}
	.dash-kpi-sub {
		color: var(--d-muted);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
