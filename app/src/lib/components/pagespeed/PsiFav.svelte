<script lang="ts">
	// „Favicon" de site: imaginea reală (Google s2, ca în Linkuri SEO / WordPress),
	// cu fallback pe pătratul colorat cu inițiale din design dacă imaginea pică.
	import { getFaviconUrl } from '$lib/utils';
	import { psiInitials, psiTileColor } from './lib';

	let {
		id,
		domain,
		url,
		size = 30,
		radius = 8,
		fontSize = 12
	}: {
		id: string;
		domain: string;
		url?: string | null;
		size?: number;
		radius?: number;
		fontSize?: number;
	} = $props();

	// starea de eroare e legată de sursa curentă — la schimbarea URL-ului se reia încercarea
	let failedFor = $state<string | null>(null);
	const src = $derived(getFaviconUrl(url || domain));
	const failed = $derived(failedFor === src);
</script>

{#if src && !failed}
	<span
		class="psi-fav psi-fav-img"
		style:width="{size}px"
		style:height="{size}px"
		style:border-radius="{radius}px"
	>
		<img
			{src}
			alt=""
			width={Math.round(size * 0.66)}
			height={Math.round(size * 0.66)}
			loading="lazy"
			onerror={() => (failedFor = src)}
		/>
	</span>
{:else}
	<span
		class="psi-fav"
		style:background={psiTileColor(id)}
		style:width="{size}px"
		style:height="{size}px"
		style:border-radius="{radius}px"
		style:font-size="{fontSize}px">{psiInitials(domain)}</span
	>
{/if}
