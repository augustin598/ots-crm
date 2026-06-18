<script lang="ts">
	import type { DailyAggregate } from '$lib/utils/report-helpers';
	import { fmtCompact, formatCurrency, formatNumber, fmtDateShort, fmtDateRo } from './rk-helpers';

	let { daily, cur = 'RON' }: { daily: DailyAggregate[]; cur?: string } = $props();

	type MetricKey = 'spend' | 'impressions' | 'linkClicks';
	let metric = $state<MetricKey>('spend');
	let hi = $state<number | null>(null);

	const W = 720,
		H = 280,
		padL = 64,
		padR = 16,
		padT = 16,
		padB = 30;
	const innerW = W - padL - padR;
	const innerH = H - padT - padB;

	const cfgs: Record<MetricKey, { label: string; color: string; title: string; fmt: (v: number) => string }> = {
		spend: { label: 'Cheltuieli', color: '#1877F2', title: 'Cheltuieli în timp', fmt: (v) => fmtCompact(v) + ' RON' },
		impressions: { label: 'Impresii', color: '#6366f1', title: 'Impresii în timp', fmt: (v) => fmtCompact(v) },
		linkClicks: { label: 'Click-uri', color: '#0ea5e9', title: 'Click-uri în timp', fmt: (v) => fmtCompact(v) }
	};

	const cfg = $derived(cfgs[metric]);
	const vals = $derived(daily.map((d) => Number(d[metric]) || 0));
	const max = $derived(Math.max(...vals, 1) * 1.1);
	const x = (i: number) => padL + (i / Math.max(daily.length - 1, 1)) * innerW;
	const y = (v: number) => padT + innerH - (v / max) * innerH;
	const path = $derived(vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' '));
	const area = $derived(`${path} L${x(vals.length - 1)},${padT + innerH} L${padL},${padT + innerH} Z`);
	const ticks = $derived([0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => ({ v: max * t, y: padT + innerH - t * innerH })));
	const every = $derived(Math.max(1, Math.ceil(daily.length / 7)));
	const bandW = $derived(innerW / Math.max(daily.length - 1, 1));
	const tipFmt = $derived(metric === 'spend' ? (v: number) => formatCurrency(v, cur) : (v: number) => formatNumber(v));
	const gradId = 'rk-spendgrad';
</script>

<div class="rk-card">
	<div class="rk-card-head">
		<h3 class="rk-card-title">{cfg.title}</h3>
		<div class="rk-seg">
			{#each Object.entries(cfgs) as [k, v] (k)}
				<button
					class="rk-seg-btn {metric === k ? 'active' : ''}"
					style={metric === k ? `--seg:${v.color}` : ''}
					onclick={() => (metric = k as MetricKey)}>{v.label}</button>
			{/each}
		</div>
	</div>
	<div class="rk-chart-wrap" role="img" onmouseleave={() => (hi = null)}>
		<svg viewBox="0 0 {W} {H}" class="rk-chart" preserveAspectRatio="xMidYMid meet">
			{#each ticks as t, i (i)}
				<line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#eef1f6" />
				<text x={padL - 8} y={t.y + 3} text-anchor="end" class="rk-axis">{cfg.fmt(t.v)}</text>
			{/each}
			<defs>
				<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color={cfg.color} stop-opacity="0.22" />
					<stop offset="100%" stop-color={cfg.color} stop-opacity="0.01" />
				</linearGradient>
			</defs>
			<path d={area} fill="url(#{gradId})" />
			<path d={path} fill="none" stroke={cfg.color} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
			{#each daily as d, i (i)}
				{#if i % every === 0}
					<text x={x(i)} y={H - 8} text-anchor="middle" class="rk-axis">{fmtDateShort(d.date)}</text>
				{/if}
			{/each}
			{#if hi != null}
				<line x1={x(hi)} y1={padT} x2={x(hi)} y2={padT + innerH} stroke={cfg.color} stroke-opacity="0.35" stroke-dasharray="3 3" />
				<circle cx={x(hi)} cy={y(vals[hi])} r="4.5" fill={cfg.color} stroke="white" stroke-width="2" />
			{/if}
			{#each daily as _d, i (i)}
				<rect x={x(i) - bandW / 2} y={padT} width={bandW} height={innerH} fill="transparent" onmouseenter={() => (hi = i)} role="presentation" />
			{/each}
		</svg>
		{#if hi != null}
			<div class="rk-charttip" style="left:{(x(hi) / W) * 100}%; top:{(y(vals[hi]) / H) * 100}%">
				<div class="rk-charttip-date">{fmtDateRo(daily[hi].date)}</div>
				<div class="rk-charttip-row"><i style="background:{cfg.color}"></i>{cfg.label}: <strong>{tipFmt(vals[hi])}</strong></div>
			</div>
		{/if}
	</div>
</div>
