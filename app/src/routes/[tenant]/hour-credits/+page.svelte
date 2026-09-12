<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';
	import HourCreditsOverview from './HourCreditsOverview.svelte';
	import '$lib/components/hour-credits/hour-credits.css';
</script>

<!-- Titlul și subtitlul stau în hero-ul componentei (layout edge-to-edge). -->
<svelte:boundary>
	{#snippet pending()}
		<div class="space-y-4">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-24 w-full" />
			<Skeleton class="h-64 w-full" />
		</div>
	{/snippet}
	{#snippet failed(error, reset)}
		<div
			class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30"
		>
			{error instanceof Error ? error.message : 'Nu am putut încărca bugetele de ore.'}
			<button type="button" class="ml-2 underline" onclick={reset}>Reîncearcă</button>
		</div>
	{/snippet}

	<HourCreditsOverview />
</svelte:boundary>
