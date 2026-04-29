<script lang="ts">
	import { page } from '$app/state';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';

	let { children } = $props();

	const tenantSlug = $derived(page.params.tenant as string);
	const currentPath = $derived(page.url.pathname);

	const TABS = [
		{ slug: 'facebook', label: 'Facebook / Meta', Icon: IconFacebook },
		{ slug: 'tiktok', label: 'TikTok', Icon: IconTiktok },
		{ slug: 'google', label: 'Google Ads', Icon: IconGoogleAds }
	];
</script>

<div class="border-b bg-white">
	<nav class="flex gap-1 px-6 pt-4">
		{#each TABS as tab}
			{@const href = `/${tenantSlug}/campaigns-ads/${tab.slug}`}
			{@const isActive = currentPath.startsWith(href)}
			<a
				{href}
				class="flex items-center gap-2 px-4 py-2 text-sm rounded-t-md border-b-2 transition-colors
					{isActive
					? 'border-blue-600 text-blue-700 bg-blue-50 font-medium'
					: 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'}"
			>
				<tab.Icon class="h-4 w-4" />
				{tab.label}
			</a>
		{/each}
	</nav>
</div>

{@render children()}
