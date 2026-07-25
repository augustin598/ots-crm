<script lang="ts">
	import { page } from '$app/state';
	import InterviewsView from '$lib/components/interviuri/interviews-view.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<InterviewsView homeHref={`/client/${tenant}/dashboard`} embedded isClient />
