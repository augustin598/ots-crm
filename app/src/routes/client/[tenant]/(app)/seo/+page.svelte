<script lang="ts">
	import { page } from '$app/state';
	import SeoHubView from '$lib/components/seo-hub/SeoHubView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const p = $derived(`/client/${page.params.tenant}`);
</script>

<svelte:head><title>SEO &amp; GEO &amp; AEO · Portal</title></svelte:head>

<SeoHubView
	{data}
	isClient
	moduleHrefs={{
		seoLinks: `${p}/backlinks`,
		pagespeed: `${p}/pagespeed`,
		rankTracker: `${p}/rank-tracker`,
		content: `${p}/content`
	}}
/>
