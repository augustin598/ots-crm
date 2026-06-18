<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import { rkIcon } from './rk-icons';
	import type { RkKpi } from './rk-helpers';

	let { kpis }: { kpis: RkKpi[] } = $props();
</script>

<div class="rk-kpi-grid">
	{#each kpis as kpi (kpi.label)}
		{@const Ic = rkIcon(kpi.icon)}
		{@const up = (kpi.change ?? 0) > 0}
		{@const down = (kpi.change ?? 0) < 0}
		<!-- arrow = real direction; color = good/bad per metric polarity (Cheltuieli = neutral gray) -->
		{@const chgClass = kpi.polarity === 'neutral' ? 'neutral' : kpi.polarity === 'bad' ? (up ? 'down' : 'up') : up ? 'up' : 'down'}
		<div class="rk-kpi">
			<div class="rk-kpi-ic"><Ic size={18} /></div>
			<div class="rk-kpi-body">
				<div class="rk-kpi-label">{kpi.label}</div>
				<div class="rk-kpi-value">{kpi.value}</div>
				<div class="rk-kpi-foot">
					{#if kpi.change != null}
						<span class="rk-chg {chgClass}">
							{#if up}<ArrowUp size={11} />{:else if down}<ArrowDown size={11} />{/if}
							{Math.abs(kpi.change).toLocaleString('ro-RO', { maximumFractionDigits: 1 })}%
						</span>
					{/if}
					<span class="rk-kpi-sub">{kpi.sub}</span>
				</div>
			</div>
		</div>
	{/each}
</div>
