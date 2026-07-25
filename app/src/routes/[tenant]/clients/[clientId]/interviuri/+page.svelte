<script lang="ts">
	import { page } from '$app/state';
	import InterviewsView from '$lib/components/interviuri/interviews-view.svelte';

	const tenant = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);
</script>

<InterviewsView {clientId} homeHref={`/${tenant}`} embedded />
