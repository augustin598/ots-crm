<script lang="ts">
	import type { CashflowPoint } from './types';
	import { fmtRON } from './format';

	let { data }: { data: CashflowPoint[] } = $props();

	const W = 320;
	const H = 140;
	const max = $derived(Math.max(1, ...data.map((d) => Math.max(d.inflow, d.outflow))) * 1.05);
	const totalIn = $derived(data.reduce((s, d) => s + d.inflow, 0));
	const totalOut = $derived(data.reduce((s, d) => s + d.outflow, 0));
	const net = $derived(totalIn - totalOut);
	const hasFlow = $derived(totalIn > 0 || totalOut > 0);
	const bw = $derived(W / Math.max(1, data.length));
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Cash flow forecast</div>
			<div class="dash-card-sub">
				Următoarele 30 zile · net
				<strong style:color={net >= 0 ? 'var(--d-success)' : 'var(--d-danger)'}>
					{net >= 0 ? '+' : ''}{fmtRON(net)}
				</strong>
			</div>
		</div>
	</div>
	{#if hasFlow}
		<svg viewBox="0 0 {W} {H}" class="dash-chart" preserveAspectRatio="none" aria-hidden="true">
			{#each data as d, i (i)}
				{@const inH = (d.inflow / max) * (H / 2 - 4)}
				{@const outH = (d.outflow / max) * (H / 2 - 4)}
				<rect x={i * bw + 1} y={H / 2 - inH} width={bw - 2} height={inH} fill="var(--d-success)" rx="1" opacity="0.75" />
				<rect x={i * bw + 1} y={H / 2} width={bw - 2} height={outH} fill="var(--d-danger)" rx="1" opacity="0.55" />
			{/each}
			<line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--d-border)" stroke-width="0.8" />
		</svg>
		<div class="dash-cf-foot">
			<div class="dash-cf-stat in"><span>Intrări 30z</span><strong>{fmtRON(totalIn)}</strong></div>
			<div class="dash-cf-stat out"><span>Ieșiri 30z</span><strong>{fmtRON(totalOut)}</strong></div>
		</div>
	{:else}
		<div class="dash-empty">Nicio factură scadentă în următoarele 30 zile.</div>
	{/if}
</div>
