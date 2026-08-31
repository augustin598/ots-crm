<script lang="ts">
	import { psiScoreLevel } from '$lib/logic/pagespeed';
	import { PSI_LVL, PSI_LVL_TEXT } from './lib';

	let {
		value,
		size = 40,
		stroke = 4,
		pending = false
	}: { value: number | null; size?: number; stroke?: number; pending?: boolean } = $props();

	const lvl = $derived(psiScoreLevel(value));
	const pct = $derived(value == null ? 0 : Math.max(0, Math.min(100, value)));
</script>

<div
	class={['psi-donut', pending && 'pending']}
	style:width="{size}px"
	style:height="{size}px"
	style:background="conic-gradient({PSI_LVL[lvl]} 0 {pct}%, var(--psi-track) {pct}% 100%)"
	title={value == null ? 'fără scanare' : `Scor Performance ${value}/100`}
>
	<i style:inset="{stroke}px"></i>
	<b style:font-size="{Math.round(size * 0.34)}px" style:color={PSI_LVL_TEXT[lvl]}>
		{value == null ? '–' : value}
	</b>
</div>
