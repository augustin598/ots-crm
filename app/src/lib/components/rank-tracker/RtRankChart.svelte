<script lang="ts">
	// Grafic de poziții: axă INVERSATĂ, scală logaritmică 1 → 100 (1 = sus).
	// Golurile din serii rup linia (segmente separate), ca în design.
	import type { RtDay } from './lib';

	interface Series {
		label: string;
		color: string;
		values: (number | null)[];
		thin?: boolean;
		dashed?: boolean;
	}

	let {
		days,
		series,
		height = 230,
		marks = []
	}: {
		days: RtDay[];
		series: Series[];
		height?: number;
		marks?: { i: number; label: string }[];
	} = $props();

	const W = 680;
	const padL = 30;
	const padR = 14;
	const padT = 12;
	const padB = 26;
	const ticks = [1, 3, 10, 20, 50, 100];

	// funcții simple: citesc `height`/`days` la fiecare randare
	const H = $derived(height);
	function x(i: number): number {
		return padL + (i / Math.max(1, days.length - 1)) * (W - padL - padR);
	}
	function y(p: number): number {
		return padT + (Math.log(Math.max(1, Math.min(101, p))) / Math.log(101)) * (H - padT - padB);
	}

	function segments(values: (number | null)[]): string[] {
		const segs: string[] = [];
		let cur: string[] = [];
		values.forEach((v, i) => {
			if (v == null) {
				if (cur.length) segs.push(cur.join(' '));
				cur = [];
			} else cur.push(`${x(i)},${y(v)}`);
		});
		if (cur.length) segs.push(cur.join(' '));
		return segs;
	}

	function lastValue(values: (number | null)[]): number | null {
		for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i];
		return null;
	}

	function lastIndex(values: (number | null)[]): number {
		for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
		return -1;
	}
</script>

<div class="psi-chart-wrap">
	<svg width="100%" viewBox="0 0 {W} {H}" style="display: block" role="img" aria-label="Evoluția pozițiilor">
		<rect x={padL} y={y(1)} width={W - padL - padR} height={y(3) - y(1)} fill="rgba(16,185,129,.07)" />
		<rect x={padL} y={y(3)} width={W - padL - padR} height={y(10) - y(3)} fill="rgba(24,119,242,.05)" />
		{#each ticks as t (t)}
			<g>
				<line
					x1={padL}
					x2={W - padR}
					y1={y(t)}
					y2={y(t)}
					stroke="var(--cl-border)"
					stroke-width="1"
					stroke-dasharray={t === 1 ? '' : '3 3'}
				/>
				<text x={padL - 7} y={y(t) + 3.5} text-anchor="end" font-size="9.5" fill="var(--cl-text-3)" font-weight="600">{t}</text>
			</g>
		{/each}
		{#each days as d, i (d.id)}
			{#if i % 3 === 0 || i === days.length - 1}
				<text x={x(i)} y={H - 8} text-anchor="middle" font-size="9" fill="var(--cl-text-3)" font-weight="600">{d.short}</text>
			{/if}
		{/each}
		{#each marks as m (m.i + m.label)}
			<g>
				<line x1={x(m.i)} x2={x(m.i)} y1={padT} y2={H - padB} stroke="var(--cl-border-strong)" stroke-width="1" stroke-dasharray="2 3" />
				<text x={x(m.i) + 4} y={padT + 10} font-size="9" fill="var(--cl-text-2)" font-weight="700">{m.label}</text>
			</g>
		{/each}
		{#each series as s (s.label)}
			<g>
				{#each segments(s.values) as seg, si (si)}
					<polyline
						points={seg}
						fill="none"
						stroke={s.color}
						stroke-width={s.thin ? '1.6' : '2.2'}
						stroke-linejoin="round"
						stroke-linecap="round"
						stroke-dasharray={s.dashed ? '5 4' : ''}
						opacity={s.thin ? 0.75 : 1}
					/>
				{/each}
				{#if !s.thin}
					{@const li = lastIndex(s.values)}
					{#if li >= 0}
						<circle cx={x(li)} cy={y(s.values[li] as number)} r="4" fill="var(--cl-surface)" stroke={s.color} stroke-width="2" />
					{/if}
				{/if}
			</g>
		{/each}
	</svg>
	<div class="psi-chart-legend">
		{#each series as s (s.label)}
			{@const lv = lastValue(s.values)}
			<span><i style:background={s.color}></i> {s.label} <b style="margin-left: 2px">{lv == null ? '100+' : '#' + lv}</b></span>
		{/each}
		<span style="margin-left: auto; color: var(--cl-text-3)">scală inversată · 1 = sus</span>
	</div>
</div>
