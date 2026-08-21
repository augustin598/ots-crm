<!--
	Cadrul comun al ecranelor „poartă" (`/servicii` cu parolă, `/` la intrarea în CRM):
	fundal tech, logourile platformelor plutind în spate, logo + motto deasupra
	cardului și rândul de platforme dedesubt. Stilurile stau în `routes/layout.css`
	(clasele `.ots-gate*`), ca să nu se dubleze de la o pagină la alta.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		footer,
		logo = '/onetop-logo.png',
		logoAlt = 'One Top Solution'
	}: { children: Snippet; footer?: Snippet; logo?: string | null; logoAlt?: string } = $props();

	// Logourile platformelor pe care rulăm campanii, luate de pe onetopsolution.ro.
	const PLATFORMS = [
		{ src: '/brands/gads-logo-01.svg', label: 'Google Ads' },
		{ src: '/brands/fb-logo-01.svg', label: 'Facebook' },
		{ src: '/brands/logo-tiktok-svgrepo-com.svg', label: 'TikTok' }
	];

	// Pastilele din fundal: indexul dă poziția prin clasa `.ots-chip-N`.
	const CHIPS = [0, 1, 2, 1, 0, 2];
</script>

<div class="ots-gate">
	<!-- Strat pur decorativ, deci ascuns pentru cititoarele de ecran. -->
	<div class="ots-gate-deco" aria-hidden="true">
		{#each CHIPS as platform, i (i)}
			<span class="ots-chip ots-chip-{i + 1}"><img src={PLATFORMS[platform].src} alt="" /></span>
		{/each}
	</div>

	<div class="ots-gate-inner">
		<div class="ots-gate-brand">
			<img src={logo || '/onetop-logo.png'} alt={logoAlt} />
			<!-- Același motto ca în semnătura emailurilor (BRAND_MOTTO din `email.ts`). -->
			<p class="ots-gate-motto">Digital Marketing &amp; Growth Solutions</p>
		</div>

		{@render children()}

		<div class="ots-gate-platforms">
			<span class="ots-gate-platforms-label">Campanii pe</span>
			{#each PLATFORMS as platform (platform.src)}
				<img src={platform.src} alt={platform.label} />
			{/each}
		</div>

		{@render footer?.()}
	</div>
</div>
