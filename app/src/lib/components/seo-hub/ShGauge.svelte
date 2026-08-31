<script lang="ts">
	// Gauge semicerc pentru scorul general (50% SEO + 25% AEO + 25% GEO).
	// Praguri de culoare identice cu PageSpeed (psiScoreLevel).
	import { psiScoreLevel } from '$lib/logic/pagespeed';
	import { PSI_LVL, PSI_LVL_TEXT } from '../pagespeed/lib';

	let { value, size = 52 }: { value: number | null; size?: number } = $props();

	const lvl = $derived(psiScoreLevel(value));
	const h = $derived(Math.round(size * 0.62));
	const stroke = $derived(Math.max(4, Math.round(size * 0.11)));
	const r = $derived((size - stroke) / 2);
	const circumference = $derived(Math.PI * r);
	const pct = $derived(value == null ? 0 : Math.max(0, Math.min(100, value)) / 100);
</script>

<span
	class="sh-gauge"
	style:width="{size}px"
	style:height="{h}px"
	title={value == null ? 'fără articole analizate' : `Scor general ${value}/100`}
>
	<svg width={size} height={h} viewBox="0 0 {size} {h}" aria-hidden="true">
		<path
			d="M {stroke / 2} {h - stroke / 2} A {r} {r} 0 0 1 {size - stroke / 2} {h - stroke / 2}"
			fill="none"
			stroke="var(--psi-track)"
			stroke-width={stroke}
			stroke-linecap="round"
		/>
		{#if value != null}
			<path
				d="M {stroke / 2} {h - stroke / 2} A {r} {r} 0 0 1 {size - stroke / 2} {h - stroke / 2}"
				fill="none"
				stroke={PSI_LVL[lvl]}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-dasharray="{circumference * pct} {circumference}"
			/>
		{/if}
	</svg>
	<b style:font-size="{Math.round(size * 0.3)}px" style:color={PSI_LVL_TEXT[lvl]}>
		{value == null ? '—' : value}
	</b>
</span>
