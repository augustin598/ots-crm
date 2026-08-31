<script lang="ts">
	import { page } from '$app/state';
	import ContentHubView from '$lib/components/content/content-hub-view.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<ContentHubView
	basePath={`/${tenant}/content`}
	homeHref={`/${tenant}`}
	seoHubHref={`/${tenant}/seo`}
/>
