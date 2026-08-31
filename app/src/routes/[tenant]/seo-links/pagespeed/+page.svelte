<script lang="ts">
	import { page } from '$app/state';
	import PagespeedView from '$lib/components/pagespeed/PagespeedView.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<svelte:head>
	<title>PageSpeed Insights - CRM</title>
</svelte:head>

<PagespeedView homeHref={`/${tenant}`} />
