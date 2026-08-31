<script lang="ts">
	import { page } from '$app/state';
	import InterviewsKpiView from '$lib/components/interviuri/kpi/InterviewsKpiView.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<svelte:head><title>KPI Performanță Interviuri</title></svelte:head>
<InterviewsKpiView
	homeHref={`/client/${tenant}/dashboard`}
	interviewsHref={`/client/${tenant}/interviuri`}
	isClient
/>
