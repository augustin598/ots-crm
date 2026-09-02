<script lang="ts">
	// Sparkline pe 30 de zile. 101 = în afara top 100 (ca în design); verde dacă
	// poziția de azi e mai bună decât cea de la începutul ferestrei.
	let {
		values,
		w = 84,
		h = 26
	}: { values: (number | null)[]; w?: number; h?: number } = $props();

	const vals = $derived(values.map((v) => (v == null ? 101 : v)));
	const empty = $derived(values.length < 2 || values.every((v) => v == null));

	const geom = $derived.by(() => {
		if (empty) return null;
		const min = Math.max(1, Math.min(...vals) - 2);
		const max = Math.max(...vals) + 2;
		const span = Math.max(4, max - min);
		const pts = vals.map(
			(v, i) =>
				[(i / (vals.length - 1)) * (w - 4) + 2, 3 + ((v - min) / span) * (h - 6)] as [number, number]
		);
		const first = vals[0];
		const now = vals[vals.length - 1];
		return {
			points: pts.map((p) => p.join(',')).join(' '),
			last: pts[pts.length - 1],
			color: now < first ? '#10b981' : now > first ? '#ef4444' : '#94a3b8'
		};
	});
</script>

{#if !geom}
	<span class="iv-muted">—</span>
{:else}
	<svg class="psi-spark" width={w} height={h} viewBox="0 0 {w} {h}" aria-hidden="true">
		<polyline
			points={geom.points}
			fill="none"
			stroke={geom.color}
			stroke-width="1.7"
			stroke-linejoin="round"
			stroke-linecap="round"
			opacity=".9"
		/>
		<circle cx={geom.last[0]} cy={geom.last[1]} r="2.6" fill={geom.color} />
	</svg>
{/if}
