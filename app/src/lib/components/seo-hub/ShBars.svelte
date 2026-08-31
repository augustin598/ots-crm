<script lang="ts">
	// Trei bare mici SEO / AEO / GEO cu culorile dedicate axelor (sh-seo/aeo/geo).
	let {
		seo,
		aeo,
		geo
	}: { seo: number | null; aeo: number | null; geo: number | null } = $props();

	const rows = $derived([
		{ key: 'SEO', value: seo, color: 'var(--sh-seo)' },
		{ key: 'AEO', value: aeo, color: 'var(--sh-aeo)' },
		{ key: 'GEO', value: geo, color: 'var(--sh-geo)' }
	]);
</script>

<div class="sh-bars">
	{#each rows as r (r.key)}
		<div class="sh-bar" title="{r.key}: {r.value == null ? 'fără articole analizate' : `${r.value}/100`}">
			<span class="sh-bar-lbl">{r.key}</span>
			<span class="sh-bar-track">
				<i style:width="{r.value ?? 0}%" style:background={r.color}></i>
			</span>
			<span class="sh-bar-val" style:color={r.value == null ? 'var(--cl-text-3)' : 'var(--cl-text)'}>
				{r.value ?? '—'}
			</span>
		</div>
	{/each}
</div>
