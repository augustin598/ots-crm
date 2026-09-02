<script lang="ts">
	// Grafic de trend pe 30 de zile: vizibilitatea (0-100, mai mare = mai bine).
	// Zilele fără date rămân goluri vizibile (spec: gap, nu interpolare).
	let {
		days,
		values,
		label = 'Vizibilitate'
	}: { days: string[]; values: (number | null)[]; label?: string } = $props();

	const W = 640;
	const H = 200;
	const PAD = 28;

	const points = $derived(
		values.map((v, i) => {
			if (v == null) return null;
			const x = PAD + (i / Math.max(1, days.length - 1)) * (W - 2 * PAD);
			const y = PAD + (1 - v / 100) * (H - 2 * PAD);
			return { x, y, v, i };
		})
	);

	// Segmente continue (întrerupte la null) pentru linia poligonală.
	const segments = $derived.by(() => {
		const segs: { x: number; y: number }[][] = [];
		let cur: { x: number; y: number }[] = [];
		for (const p of points) {
			if (p == null) {
				if (cur.length) segs.push(cur);
				cur = [];
			} else {
				cur.push({ x: p.x, y: p.y });
			}
		}
		if (cur.length) segs.push(cur);
		return segs;
	});

	const dots = $derived(points.filter((p): p is NonNullable<typeof p> => p != null));
	const firstDay = $derived(days[0] ?? '');
	const lastDay = $derived(days[days.length - 1] ?? '');
	const line = (seg: { x: number; y: number }[]) => seg.map((p) => `${p.x},${p.y}`).join(' ');
</script>

<svg class="rk-chart" viewBox="0 0 {W} {H}" role="img" aria-label="{label} pe 30 de zile">
	<!-- benzi orientative 25/50/75 -->
	{#each [0, 25, 50, 75, 100] as g (g)}
		{@const y = PAD + (1 - g / 100) * (H - 2 * PAD)}
		<line class="rk-chart-axis" x1={PAD} y1={y} x2={W - PAD} y2={y} />
		<text class="rk-chart-label" x={4} y={y + 3}>{g}</text>
	{/each}

	{#each segments as seg, si (si)}
		<polyline class="rk-chart-line" points={line(seg)} />
	{/each}
	{#each dots as p (p.i)}
		<circle class="rk-chart-dot" cx={p.x} cy={p.y} r="2.5">
			<title>{days[p.i]}: {p.v}%</title>
		</circle>
	{/each}

	<text class="rk-chart-label" x={PAD} y={H - 6}>{firstDay}</text>
	<text class="rk-chart-label" x={W - PAD} y={H - 6} text-anchor="end">{lastDay}</text>
</svg>
