<script lang="ts">
	// Grafic linie 0–100 cu benzile Google (0–49 slab, 50–89 mediu, 90–100 bun).
	export interface PsiLineSeries {
		label: string;
		color: string;
		values: (number | null)[];
		dashed?: boolean;
	}

	let {
		weeks,
		series,
		height = 200
	}: {
		weeks: { id: string; label: string }[];
		series: PsiLineSeries[];
		height?: number;
	} = $props();

	const W = 660;
	const padL = 30;
	const padR = 12;
	const padT = 12;
	const padB = 26;

	function x(i: number): number {
		return padL + (i / Math.max(1, weeks.length - 1)) * (W - padL - padR);
	}
	function y(v: number): number {
		return padT + (1 - v / 100) * (height - padT - padB);
	}

	function linePoints(values: (number | null)[]): string {
		return values
			.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
			.filter(Boolean)
			.join(' ');
	}
	function lastValue(values: (number | null)[]): number | null {
		for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i];
		return null;
	}
</script>

<div class="psi-chart-wrap">
	<svg width="100%" viewBox="0 0 {W} {height}" style="display: block" aria-hidden="true">
		<rect x={padL} y={y(49)} width={W - padL - padR} height={y(0) - y(49)} fill="rgba(239,68,68,.055)" />
		<rect x={padL} y={y(89)} width={W - padL - padR} height={y(50) - y(89)} fill="rgba(245,158,11,.055)" />
		<rect x={padL} y={y(100)} width={W - padL - padR} height={y(90) - y(100)} fill="rgba(16,185,129,.07)" />
		{#each [0, 50, 90, 100] as v (v)}
			<line
				x1={padL}
				x2={W - padR}
				y1={y(v)}
				y2={y(v)}
				stroke="var(--cl-border)"
				stroke-width="1"
				stroke-dasharray={v === 0 || v === 100 ? '' : '3 3'}
			/>
			<text x={padL - 7} y={y(v) + 3.5} text-anchor="end" font-size="9.5" fill="var(--cl-text-3)" font-weight="600">{v}</text>
		{/each}
		{#each weeks as wk, i (wk.id)}
			<text x={x(i)} y={height - 8} text-anchor="middle" font-size="9.5" fill="var(--cl-text-3)" font-weight="600">{wk.label}</text>
		{/each}
		{#each series as s (s.label)}
			<g>
				<polyline
					points={linePoints(s.values)}
					fill="none"
					stroke={s.color}
					stroke-width="2.2"
					stroke-linejoin="round"
					stroke-linecap="round"
					stroke-dasharray={s.dashed ? '5 4' : ''}
				/>
				{#each s.values as v, i (i)}
					{#if v != null}
						<circle
							cx={x(i)}
							cy={y(v)}
							r={i === s.values.length - 1 ? 4 : 2.6}
							fill="var(--cl-surface)"
							stroke={s.color}
							stroke-width="2"
						/>
					{/if}
				{/each}
			</g>
		{/each}
	</svg>
	<div class="psi-chart-legend">
		{#each series as s (s.label)}
			<span><i style:background={s.color}></i> {s.label} <b style="margin-left: 2px">{lastValue(s.values) ?? '—'}</b></span>
		{/each}
		<span style="margin-left: auto; color: var(--cl-text-3)">benzi: 0–49 slab · 50–89 mediu · 90–100 bun</span>
	</div>
</div>
