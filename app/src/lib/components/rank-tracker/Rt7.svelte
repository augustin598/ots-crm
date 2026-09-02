<script lang="ts">
	// Ultimele 7 zile, cea mai recentă la dreapta. Celula e colorată față de ziua precedentă.
	import { rtDay } from './lib';

	let { values, days }: { values: (number | null)[]; days: string[] } = $props();

	const cells = $derived(
		values.map((pos, i) => {
			const prev = i > 0 ? values[i - 1] : null;
			const cls =
				pos == null ? 'empty' : prev == null ? '' : pos < prev ? 'up' : pos > prev ? 'down' : '';
			const day = days[i] ? rtDay(days[i]) : null;
			return {
				key: days[i] ?? String(i),
				cls,
				text: pos == null ? '–' : String(pos),
				title: `${day ? day.full + ' · ' : ''}${pos == null ? 'peste 100' : 'poziția ' + pos}`
			};
		})
	);
</script>

<span class="rt-7">
	{#each cells as c (c.key)}
		<i class={c.cls} title={c.title}>{c.text}</i>
	{/each}
</span>
