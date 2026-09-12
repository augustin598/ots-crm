<script lang="ts">
	import HourlyRatesSettings from './HourlyRatesSettings.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import '$lib/components/hour-credits/hour-credits.css';
</script>

<!-- Titlul și descrierea stau în hero-ul componentei (layout edge-to-edge). -->

<svelte:boundary>
	{#snippet pending()}
		<div class="space-y-6">
			<Skeleton class="h-48 w-full" />
			<Skeleton class="h-64 w-full" />
			<Skeleton class="h-40 w-full" />
		</div>
	{/snippet}
	{#snippet failed(error, reset)}
		<div
			class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30"
		>
			{remoteErrorMessage(error, 'Nu am putut încărca tarifele.')}
			<button type="button" class="ml-2 underline" onclick={reset}>Reîncearcă</button>
		</div>
	{/snippet}

	<HourlyRatesSettings />
</svelte:boundary>
