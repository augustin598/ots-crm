<script lang="ts">
	// Pastila de poziție, colorată pe nivel (top3/top10/top20/low/out).
	import { rtDay, rtDaysAgoLabel, rtPosLevel } from './lib';

	// `depth` = câte poziții s-au căutat efectiv. Fără el am afirma „100+" pentru un
	// cuvânt pe care l-am căutat doar în primele 30 — poate fi pe 35, nu știm.
	// `stale` = poziția e ultima confirmată (acum N zile), nu măsurătoarea de azi:
	// pastila rămâne colorată pe nivel, dar cu contur întrerupt și explicație în tooltip.
	let {
		pos,
		sm = false,
		depth = 100,
		stale = null
	}: {
		pos: number | null;
		sm?: boolean;
		depth?: number;
		stale?: { dayKey: string; daysAgo: number } | null;
	} = $props();

	const label = $derived(pos == null ? `${depth}+` : String(pos));
	const title = $derived(
		pos == null
			? `negăsit în primele ${depth} rezultate`
			: stale
				? `poziția ${pos} — ultima confirmată ${rtDaysAgoLabel(stale.daysAgo)} (${rtDay(stale.dayKey).short}); scanarea de azi nu a găsit site-ul în primele ${depth}`
				: `poziția ${pos}`
	);
</script>

<span class={['rt-pos', rtPosLevel(pos), { sm, stale: !!stale && pos != null }]} {title}>{label}</span>
