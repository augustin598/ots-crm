<script lang="ts">
	// Ultimele 7 zile, cea mai recentă la dreapta. Celula e colorată față de ziua precedentă.
	import { rtDay } from './lib';

	let {
		values,
		days,
		checked
	}: { values: (number | null)[]; days: string[]; checked?: boolean[] } = $props();

	const cells = $derived(
		values.map((pos, i) => {
			const prev = i > 0 ? values[i - 1] : null;
			// `checked` lipsă = presupunem că s-a rulat (compatibil cu apelurile vechi).
			const ran = checked ? checked[i] !== false : true;
			const cls =
				!ran ? 'empty' : pos == null ? 'empty' : prev == null ? '' : pos < prev ? 'up' : pos > prev ? 'down' : '';
			const day = days[i] ? rtDay(days[i]) : null;
			const state = !ran ? 'fără rulare' : pos == null ? 'peste 100' : 'poziția ' + pos;
			return {
				key: days[i] ?? String(i),
				cls,
				text: !ran ? '·' : pos == null ? '–' : String(pos),
				title: `${day ? day.full + ' · ' : ''}${state}`
			};
		})
	);
</script>

<span class="rt-7">
	{#each cells as c (c.key)}
		<i class={c.cls} title={c.title}>{c.text}</i>
	{/each}
</span>
