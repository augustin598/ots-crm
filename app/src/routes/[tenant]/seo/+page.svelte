<script lang="ts">
	import SeoHubView from '$lib/components/seo-hub/SeoHubView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>SEO &amp; GEO &amp; AEO · CRM</title></svelte:head>

<SeoHubView {data} />
