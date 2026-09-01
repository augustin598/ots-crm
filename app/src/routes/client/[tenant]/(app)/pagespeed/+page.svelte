<script lang="ts">
	import PagespeedClientView from '$lib/components/pagespeed/PagespeedClientView.svelte';
	import type { PsiSiteRow } from '$lib/components/pagespeed/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// același cast ca în PagespeedView (admin): rândurile Drizzle → tipul UI
	const view = $derived({
		lastScanAt: data.lastScanAt,
		trend: data.trend,
		sites: data.sites as unknown as PsiSiteRow[]
	});
</script>

<svelte:head><title>PageSpeed Insights · Portal</title></svelte:head>

<PagespeedClientView data={view} />
