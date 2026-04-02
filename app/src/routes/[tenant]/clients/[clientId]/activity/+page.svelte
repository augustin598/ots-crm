<script lang="ts">
	import { page } from '$app/state';
	import ClientActivityFeed from '$lib/components/client/ClientActivityFeed.svelte';
	import ActivityFilterBar from '$lib/components/client/ActivityFilterBar.svelte';

	const clientId = $derived(page.params.clientId as string);

	let activeFilter = $state('all');
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-lg font-semibold">Activitate</h2>
		<p class="text-sm text-muted-foreground">Toate evenimentele legate de acest client</p>
	</div>

	<ActivityFilterBar bind:activeFilter />

	<ClientActivityFeed {clientId} {activeFilter} />
</div>
