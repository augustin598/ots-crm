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

	// hover: punctul cel mai apropiat de cursor, cu ghidaj vertical + tooltip
	let plotEl = $state<HTMLDivElement | null>(null);
	let hover = $state<number | null>(null);

	function pick(e: PointerEvent) {
		if (!plotEl || !weeks.length) return;
		const rect = plotEl.getBoundingClientRect();
		if (!rect.width) return;
		// din pixeli de ecran în coordonate viewBox (svg-ul e scalat la lățimea containerului)
		const vx = ((e.clientX - rect.left) / rect.width) * W;
		const step = (W - padL - padR) / Math.max(1, weeks.length - 1);
		const idx = Math.round((vx - padL) / step);
		hover = Math.max(0, Math.min(weeks.length - 1, idx));
	}

	// tooltipul stă deasupra celui mai de sus punct din coloana hover; dacă nu are loc
	// (punct lipit de plafonul graficului), se răstoarnă sub punct
	let plotH = $state(0);
	let tipH = $state(0);
	const tipTop = $derived.by(() => {
		if (hover === null) return 0;
		const ys = series.map((s) => s.values[hover!]).filter((v): v is number => v != null).map(y);
		return ys.length ? Math.min(...ys) : y(100);
	});
	const tipLeft = $derived(hover === null ? 0 : (x(hover) / W) * 100);
	// lângă margini tooltipul se aliniază la stânga/dreapta ca să nu iasă din card
	const tipShift = $derived(tipLeft < 15 ? '0%' : tipLeft > 85 ? '-100%' : '-50%');
	const tipBelow = $derived((tipTop / height) * plotH < tipH + 12);
</script>

<div class="psi-chart-wrap">
	<!-- suprafața de hover ține evenimentele de pointer, deci are nevoie de un rol:
	     graficul e o imagine, iar valorile exacte sunt oricum în legendă și în tabel -->
	<div
		class="psi-chart-plot"
		role="img"
		aria-label="Grafic pe săptămâni: {series.map((s) => s.label).join(', ')}"
		bind:this={plotEl}
		bind:clientHeight={plotH}
		onpointermove={pick}
		onpointerdown={pick}
		onpointerleave={() => (hover = null)}
	>
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
			{#if hover !== null}
				<line
					x1={x(hover)}
					x2={x(hover)}
					y1={y(100)}
					y2={y(0)}
					stroke="var(--cl-text-3)"
					stroke-width="1"
					stroke-dasharray="4 3"
					opacity="0.55"
				/>
			{/if}
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
								r={hover === i ? 5 : i === s.values.length - 1 ? 4 : 2.6}
								fill="var(--cl-surface)"
								stroke={s.color}
								stroke-width="2"
							/>
						{/if}
					{/each}
				</g>
			{/each}
		</svg>
		{#if hover !== null}
			<div
				class="psi-chart-tip"
				bind:clientHeight={tipH}
				style:left="{tipLeft}%"
				style:top="{(tipTop / height) * 100}%"
				style:transform="translate({tipShift}, {tipBelow ? '12px' : 'calc(-100% - 10px)'})"
			>
				<div class="psi-chart-tip-h">{weeks[hover].label}</div>
				{#each series as s (s.label)}
					<div class="psi-chart-tip-r">
						<i style:background={s.color}></i>{s.label}<b>{s.values[hover] ?? '—'}</b>
					</div>
				{/each}
			</div>
		{/if}
	</div>
	<div class="psi-chart-legend">
		{#each series as s (s.label)}
			<span><i style:background={s.color}></i> {s.label} <b style="margin-left: 2px">{lastValue(s.values) ?? '—'}</b></span>
		{/each}
		<span style="margin-left: auto; color: var(--cl-text-3)">benzi: 0–49 slab · 50–89 mediu · 90–100 bun</span>
	</div>
</div>
