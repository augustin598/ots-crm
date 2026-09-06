<script lang="ts">
	// Bara de vizibilitate estimată din CTR pe poziție.
	let { pct }: { pct: number } = $props();

	// „7,6%", nu „7.6%": pe același rând cu poziția medie formatată ro-RO, punctul
	// arăta ca două convenții diferite în același tabel.
	const label = $derived(pct.toLocaleString('ro-RO', { maximumFractionDigits: 1 }));
</script>

<span class="rt-vis" title="vizibilitate estimată din CTR pe poziție">
	<span class="rt-vis-track"><i style:width="{Math.max(2, Math.min(100, pct))}%"></i></span>
	<span class="rt-vis-val">{label}%</span>
</span>
