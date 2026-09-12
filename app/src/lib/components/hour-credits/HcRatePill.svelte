<script lang="ts">
	/**
	 * Pastila de specializare / regim: punct colorat + etichetă.
	 *
	 * Culoarea vine din slug, nu din poziția în listă, ca aceeași specializare să
	 * arate la fel în cardul taskului, în raportul lunar și în fișa clientului.
	 * Punctul poartă culoarea, textul rămâne pe contrastul temei — un chip complet
	 * colorat la 11px ar coborî sub pragul de lizibilitate.
	 */
	import { modeColor, prettyModeLabel, prettyRateLabel, rateColor } from './hour-credits-format';

	let {
		slug,
		kind = 'rate',
		title
	}: { slug: string | null | undefined; kind?: 'rate' | 'mode'; title?: string } = $props();

	const color = $derived(kind === 'mode' ? modeColor(slug) : rateColor(slug));
	const label = $derived(kind === 'mode' ? prettyModeLabel(slug) : prettyRateLabel(slug));
</script>

<span class="hc-pill" title={title ?? label}>
	<i class="hc-pill-dot" style:background={color}></i>
	{label}
</span>
