<script lang="ts">
	import { page } from '$app/state';
	import WebsiteContentView from '$lib/components/content/website-content-view.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<WebsiteContentView
	basePath={`/client/${tenant}/content`}
	homeHref={`/client/${tenant}/dashboard`}
/>
