<script lang="ts">
	import { page } from '$app/state';
	import ContentHubView from '$lib/components/content/content-hub-view.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<ContentHubView
	basePath={`/client/${tenant}/content`}
	homeHref={`/client/${tenant}/dashboard`}
	isClient
/>
