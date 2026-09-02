<script lang="ts">
	// Pastila de poziție, colorată pe nivel (top3/top10/top20/low/out).
	import { rtPosLevel } from './lib';

	let { pos, sm = false }: { pos: number | null; sm?: boolean } = $props();
</script>

<span
	class="rt-pos {rtPosLevel(pos)}"
	class:sm
	title={pos == null ? 'în afara top 100' : `poziția ${pos}`}>{pos == null ? '100+' : pos}</span
>
