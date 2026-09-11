<script lang="ts">
	import { page } from '$app/state';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import PortalHourCreditView from './PortalHourCreditView.svelte';

	const tenant = $derived(page.params.tenant as string);
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Credit de ore</h1>
		<p class="text-sm text-muted-foreground">
			Orele disponibile pentru task-urile companiei tale și istoricul lor. Ai nevoie de mai multe
			ore?
			<a class="underline" href="/servicii">Cumpără ore pe /servicii</a> sau
			<a class="underline" href="/client/{tenant}/tasks">vezi task-urile</a>.
		</p>
	</div>

	<svelte:boundary>
		{#snippet pending()}
			<div class="space-y-4">
				<Skeleton class="h-24 w-full" />
				<Skeleton class="h-64 w-full" />
			</div>
		{/snippet}
		{#snippet failed(error, reset)}
			<div
				class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30"
			>
				{error instanceof Error ? error.message : 'Nu am putut încărca creditul de ore.'}
				<button type="button" class="ml-2 underline" onclick={reset}>Reîncearcă</button>
			</div>
		{/snippet}

		<PortalHourCreditView />
	</svelte:boundary>
</div>
