<script lang="ts">
	import { page } from '$app/state';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import '$lib/components/campaigns-ads/campaigns-ads.css';

	let { children } = $props();

	const tenantSlug = $derived(page.params.tenant as string);
	const currentPath = $derived(page.url.pathname);

	const TABS = [
		{ slug: 'facebook', label: 'Facebook & Instagram', Icon: IconFacebook },
		{ slug: 'tiktok', label: 'TikTok', Icon: IconTiktok },
		{ slug: 'google', label: 'Google Ads', Icon: IconGoogleAds }
	];
</script>

<div class="ca-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Campanii Ads</h1>
			<p class="page-sub">Gestionează campaniile tale Meta, TikTok și Google din același loc.</p>
		</div>
	</div>

	<nav class="platform-tabs" aria-label="Platforme">
		{#each TABS as tab (tab.slug)}
			{@const href = `/${tenantSlug}/campaigns-ads/${tab.slug}`}
			<a {href} class={['platform-tab', currentPath.startsWith(href) && 'active']}>
				<tab.Icon class="h-4 w-4" />
				{tab.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>

<style>
	/* [tenant]/+layout.svelte pune deja p-6 pe <main> — anulăm ca fundalul
	   designului să fie full-bleed, apoi repunem padding-ul designului. */
	.ca-page {
		margin: -1.5rem;
		padding: 20px 28px 32px;
		background: var(--ca-bg);
		min-height: calc(100vh - 3.5rem);
	}
</style>
