<script lang="ts">
	import { fmtCompact, formatCurrency, formatNumber, fmtDateShort, fmtDateRo } from './rk-helpers';

	export interface ComboPoint {
		date: string;
		result: number;
		cost: number;
	}
	let { series, resultLabel = 'Rezultate', cur = 'RON' }: { series: ComboPoint[]; resultLabel?: string; cur?: string } = $props();

	let hi = $state<number | null>(null);

	const W = 720,
		H = 280,
		padL = 44,
		padR = 64,
		padT = 16,
		padB = 30;
	const innerW = W - padL - padR;
	const innerH = H - padT - padB;

	const bars = $derived(series.map((d) => d.result));
	const costs = $derived(series.map((d) => d.cost));
	const maxBar = $derived(Math.max(...bars, 1) * 1.15);
	const maxCost = $derived(Math.max(...costs, 1) * 1.15);
	const bw = $derived((innerW / Math.max(series.length, 1)) * 0.55);
	const xc = (i: number) => padL + (i + 0.5) * (innerW / Math.max(series.length, 1));
	const yb = (v: number) => padT + innerH - (v / maxBar) * innerH;
	const yc = (v: number) => padT + innerH - (v / maxCost) * innerH;
	const linePath = $derived(costs.map((v, i) => `${i === 0 ? 'M' : 'L'}${xc(i)},${yc(v)}`).join(' '));
	const ticksL = $derived([0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: maxBar * t, y: padT + innerH - t * innerH })));
	const ticksR = $derived([0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: maxCost * t, y: padT + innerH - t * innerH })));
	const every = $derived(Math.max(1, Math.ceil(series.length / 7)));
	const bandW = $derived(innerW / Math.max(series.length, 1));
</script>

<div class="rk-card">
	<div class="rk-card-head">
		<h3 class="rk-card-title">{resultLabel} &amp; Cost/rezultat</h3>
		<div class="rk-legend">
			<span><i class="dot" style="background:#10b981"></i>{resultLabel}</span>
			<span><i class="dot" style="background:#f97316"></i>Cost/rezultat</span>
		</div>
	</div>
	<div class="rk-chart-wrap" role="img" onmouseleave={() => (hi = null)}>
		<svg viewBox="0 0 {W} {H}" class="rk-chart" preserveAspectRatio="xMidYMid meet">
			{#each ticksL as t, i (i)}
				<line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#eef1f6" />
				<text x={padL - 6} y={t.y + 3} text-anchor="end" class="rk-axis">{Math.round(t.v)}</text>
			{/each}
			{#each ticksR as t, i (i)}
				<text x={W - padR + 6} y={t.y + 3} text-anchor="start" class="rk-axis">{fmtCompact(t.v)}</text>
			{/each}
			{#each bars as v, i (i)}
				<rect x={xc(i) - bw / 2} y={yb(v)} width={bw} height={padT + innerH - yb(v)} rx="2" fill="#10b981" opacity={hi === i ? 0.6 : 0.32} />
			{/each}
			<path d={linePath} fill="none" stroke="#f97316" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
			{#each costs as v, i (i)}
				{#if i % every === 0}<circle cx={xc(i)} cy={yc(v)} r="2.5" fill="#f97316" />{/if}
			{/each}
			{#each series as d, i (i)}
				{#if i % every === 0}<text x={xc(i)} y={H - 8} text-anchor="middle" class="rk-axis">{fmtDateShort(d.date)}</text>{/if}
			{/each}
			{#if hi != null}
				<line x1={xc(hi)} y1={padT} x2={xc(hi)} y2={padT + innerH} stroke="#f97316" stroke-opacity="0.4" stroke-dasharray="3 3" />
				<circle cx={xc(hi)} cy={yc(costs[hi])} r="4.5" fill="#f97316" stroke="white" stroke-width="2" />
			{/if}
			{#each series as _d, i (i)}
				<rect x={padL + i * bandW} y={padT} width={bandW} height={innerH} fill="transparent" onmouseenter={() => (hi = i)} role="presentation" />
			{/each}
		</svg>
		{#if hi != null}
			<div class="rk-charttip" style="left:{(xc(hi) / W) * 100}%; top:{(yc(costs[hi]) / H) * 100}%">
				<div class="rk-charttip-date">{fmtDateRo(series[hi].date)}</div>
				<div class="rk-charttip-row"><i style="background:#f97316"></i>Cost/rezultat: <strong>{formatCurrency(costs[hi], cur)}</strong></div>
				<div class="rk-charttip-row"><i style="background:#10b981"></i>{resultLabel}: <strong>{formatNumber(bars[hi])}</strong></div>
			</div>
		{/if}
	</div>
</div>
