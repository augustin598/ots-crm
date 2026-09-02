<script lang="ts">
	// Pastila de poziție, colorată pe nivel (top3/top10/top20/low/out).
	import { rtPosLevel } from './lib';

	// `depth` = câte poziții s-au căutat efectiv. Fără el am afirma „100+" pentru un
	// cuvânt pe care l-am căutat doar în primele 30 — poate fi pe 35, nu știm.
	let {
		pos,
		sm = false,
		depth = 100
	}: { pos: number | null; sm?: boolean; depth?: number } = $props();

	const label = $derived(pos == null ? `${depth}+` : String(pos));
	const title = $derived(
		pos == null ? `negăsit în primele ${depth} rezultate` : `poziția ${pos}`
	);
</script>

<span class="rt-pos {rtPosLevel(pos)}" class:sm {title}>{label}</span>
