<script lang="ts">
	import IconCircleAlert from '@lucide/svelte/icons/circle-alert';
	import IconDollarSign from '@lucide/svelte/icons/dollar-sign';
	import IconPause from '@lucide/svelte/icons/pause';
	import IconZap from '@lucide/svelte/icons/zap';
	import { fmtMoneyRound, type CampaignKpis } from '$lib/utils/meta-campaigns';
	import Sparkline from './sparkline.svelte';

	interface Props {
		kpis: CampaignKpis;
		currency: string;
		dailySpend: Array<{ date: string; spend: number }>;
		statusFilter: string;
		onPickStatus: (s: string) => void;
	}

	let { kpis, currency, dailySpend, statusFilter, onPickStatus }: Props = $props();

	const sparkData = $derived(dailySpend.map((d) => d.spend));
	const paceTone = $derived(kpis.pace >= 0.95 ? 'danger' : kpis.pace >= 0.8 ? 'warn' : 'ok');

	function pick(s: string) {
		onPickStatus(statusFilter === s ? '' : s);
	}
</script>

<div class="kpi-grid">
	<button
		type="button"
		class={['kpi', 'warn', 'clickable', statusFilter === 'WITH_ISSUES' && 'on']}
		aria-pressed={statusFilter === 'WITH_ISSUES'}
		onclick={() => pick('WITH_ISSUES')}
		title="Arată doar campaniile cu probleme"
	>
		<span class="kpi-label"><IconCircleAlert class="kpi-icon" /> Cu probleme</span>
		<span class="kpi-value">{kpis.issues}</span>
		<span class="kpi-foot">
			<span class="kpi-delta">
				{kpis.inProcess > 0 ? `${kpis.inProcess} în procesare` : 'Nimic în coadă'}
			</span>
		</span>
	</button>

	<button
		type="button"
		class={['kpi', 'active', 'clickable', statusFilter === 'ACTIVE' && 'on']}
		aria-pressed={statusFilter === 'ACTIVE'}
		onclick={() => pick('ACTIVE')}
		title="Arată doar campaniile active"
	>
		<span class="kpi-label"><IconZap class="kpi-icon" /> Active</span>
		<span class="kpi-value">{kpis.active}</span>
		<span class="kpi-foot">
			<span class="kpi-delta">{fmtMoneyRound(kpis.dailyBudgetActive, currency)} / zi alocat</span>
			<Sparkline data={sparkData} color="#10b981" />
		</span>
	</button>

	<button
		type="button"
		class={['kpi', 'paused', 'clickable', statusFilter === 'PAUSED' && 'on']}
		aria-pressed={statusFilter === 'PAUSED'}
		onclick={() => pick('PAUSED')}
		title="Arată doar campaniile pauzate"
	>
		<span class="kpi-label"><IconPause class="kpi-icon" /> Pauzate</span>
		<span class="kpi-value">{kpis.paused}</span>
		<span class="kpi-foot">
			<span class="kpi-delta">
				{fmtMoneyRound(kpis.dailyBudgetPaused, currency)} / zi neutilizat
			</span>
		</span>
	</button>

	<div class="kpi draft">
		<div class="kpi-label"><IconDollarSign class="kpi-icon" /> Cheltuit (perioadă)</div>
		<div class="kpi-value">{fmtMoneyRound(kpis.spend, currency)}</div>
		<div class="kpi-foot">
			<div class="kpi-cap">
				<div class="kpi-delta">
					{kpis.conversions} conversii · {kpis.conversions > 0
						? fmtMoneyRound(kpis.cpa, currency)
						: '—'} CPA
				</div>
				{#if kpis.budgetCap > 0}
					<div
						class="pace"
						title="{fmtMoneyRound(kpis.spend, currency)} din {fmtMoneyRound(
							kpis.budgetCap,
							currency
						)} plafon pe perioadă"
					>
						<div class={['pace-track', paceTone]}>
							<div class="pace-fill" style:width="{Math.min(kpis.pace * 100, 100)}%"></div>
						</div>
						<span class="pace-pct">{Math.round(kpis.pace * 100)}% plafon</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	button.kpi {
		width: 100%;
		text-align: left;
		font: inherit;
	}
	button.kpi .kpi-label,
	button.kpi .kpi-foot {
		display: flex;
	}
	button.kpi .kpi-value {
		display: block;
	}
	.kpi-cap {
		flex: 1;
		min-width: 0;
	}
</style>
