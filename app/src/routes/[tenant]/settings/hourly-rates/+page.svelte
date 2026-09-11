<script lang="ts">
	import HourlyRatesSettings from './HourlyRatesSettings.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
</script>

<p class="mb-6 text-muted-foreground">
	Tarifele pe oră după specializare, regimurile de lucru (urgență, weekend, noapte) și regulile
	creditului de ore. Aceleași valori apar pe pagina publică /servicii, în comanda de ore și pe
	facturile Keez.
</p>

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
