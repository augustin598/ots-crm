<script lang="ts">
	import RankClientView from '$lib/components/rank-tracker/RankClientView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Rank Tracker · Portal</title></svelte:head>

<RankClientView {data} />
