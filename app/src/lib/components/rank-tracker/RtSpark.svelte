<script lang="ts">
	// Sparkline pe 30 de zile. 101 = în afara top 100 (ca în design); verde dacă
	// poziția de azi e mai bună decât cea de la începutul ferestrei.
	let {
		values,
		checked,
		w = 84,
		h = 26
	}: { values: (number | null)[]; checked?: boolean[]; w?: number; h?: number } = $props();

	// `null` din `spark30` înseamnă „nu s-a rulat în ziua aia" SAU „neclasat" — nu le putem
	// deosebi. Le tratam pe toate ca 101, ceea ce desena o linie plată „în afara top 100"
	// pentru zilele dinainte de prima rulare și, mai rău, calcula culoarea față de acel 101
	// inventat: ORICE cuvânt cu istoric mai scurt de 30 de zile ieșea verde/„în creștere".
	// Acum desenăm doar din prima zi cu date încoace, iar golurile dinăuntru rămân 101
	// (acolo chiar am rulat și nu l-am găsit).
	// Prima zi în care chiar s-a rulat (sau, în lipsa lui `checked`, prima cu poziție).
	const firstIdx = $derived(
		checked ? checked.findIndex((c) => c) : values.findIndex((v) => v != null)
	);
	const vals = $derived(firstIdx < 0 ? [] : values.slice(firstIdx).map((v) => (v == null ? 101 : v)));
	const empty = $derived(vals.length < 2);

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
