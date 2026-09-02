<script lang="ts">
	// Bara de vizibilitate estimată din CTR pe poziție.
	let { pct }: { pct: number } = $props();
</script>

<span class="rt-vis" title="vizibilitate estimată din CTR pe poziție">
	<span class="rt-vis-track"><i style:width="{Math.max(2, Math.min(100, pct))}%"></i></span>
	<span class="rt-vis-val">{pct}%</span>
</span>
