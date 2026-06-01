<script lang="ts">
	import type { RevenuePoint } from './types';
	import { fmtRON } from './format';

	let { data }: { data: RevenuePoint[] } = $props();

	let mode = $state<'revenue' | 'compare' | 'profit'>('revenue');

	const W = 720;
	const H = 220;
	const P = { l: 48, r: 12, t: 16, b: 28 };

	const max = $derived(Math.max(1, ...data.map((d) => Math.max(d.revenue, d.expenses))) * 1.1);
	const xStep = $derived((W - P.l - P.r) / Math.max(1, data.length - 1));
	const yOf = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
	const xOf = (i: number) => P.l + i * xStep;

	const buildPath = (key: 'revenue' | 'expenses') =>
		data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(d[key]).toFixed(1)}`).join(' ');
	const buildArea = (key: 'revenue' | 'expenses') =>
		`${buildPath(key)} L${xOf(data.length - 1)} ${H - P.b} L${xOf(0)} ${H - P.b} Z`;

	const revPath = $derived(buildPath('revenue'));
	const revArea = $derived(buildArea('revenue'));
	const expPath = $derived(buildPath('expenses'));
	const expArea = $derived(buildArea('expenses'));
	const yTicks = $derived([0, max * 0.25, max * 0.5, max * 0.75, max].map((v) => Math.round(v)));
	const total = $derived(data.reduce((s, d) => s + d.revenue, 0));
	const profit = $derived(data.reduce((s, d) => s + (d.revenue - d.expenses), 0));
	const showExpenses = $derived(mode === 'compare' || mode === 'profit');
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Venituri & cheltuieli</div>
			<div class="dash-card-sub">Ultimele 12 luni · profit total {fmtRON(profit)}</div>
		</div>
		<div class="dash-segments">
			<button type="button" class:active={mode === 'revenue'} onclick={() => (mode = 'revenue')}>Venituri</button>
			<button type="button" class:active={mode === 'compare'} onclick={() => (mode = 'compare')}>Comparație</button>
			<button type="button" class:active={mode === 'profit'} onclick={() => (mode = 'profit')}>Profit</button>
		</div>
	</div>
	<svg viewBox="0 0 {W} {H}" class="dash-chart" preserveAspectRatio="none" aria-hidden="true">
		{#each yTicks as t, i (i)}
			<line x1={P.l} x2={W - P.r} y1={yOf(t)} y2={yOf(t)} stroke="var(--d-border)" stroke-dasharray="3 3" stroke-width="0.8" />
			<text x={P.l - 8} y={yOf(t) + 3} font-size="9" fill="var(--d-muted)" text-anchor="end">{(t / 1000).toFixed(0)}k</text>
		{/each}
		{#each data as d, i (i)}
			<text x={xOf(i)} y={H - 8} font-size="9" fill="var(--d-muted)" text-anchor="middle">{d.m}</text>
		{/each}
		<path d={revArea} fill="var(--d-primary)" opacity="0.12" />
		{#if showExpenses}<path d={expArea} fill="var(--d-danger)" opacity="0.08" />{/if}
		<path d={revPath} fill="none" stroke="var(--d-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
		{#if showExpenses}
			<path d={expPath} fill="none" stroke="var(--d-danger)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="4 3" />
		{/if}
		{#each data as d, i (i)}
			<circle cx={xOf(i)} cy={yOf(d.revenue)} r="3" fill="var(--d-card)" stroke="var(--d-primary)" stroke-width="1.5" />
		{/each}
	</svg>
	<div class="dash-legend">
		<div class="dash-legend-item"><span class="dot" style:background="var(--d-primary)"></span> Venituri ({fmtRON(total)})</div>
		{#if showExpenses}
			<div class="dash-legend-item"><span class="dot" style:background="var(--d-danger)"></span> Cheltuieli</div>
		{/if}
	</div>
</div>
