<script lang="ts">
	import { page } from '$app/state';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import HourCreditsOverview from './HourCreditsOverview.svelte';

	const tenantSlug = $derived(page.params.tenant);
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Bugete ore</h1>
		<p class="text-sm text-muted-foreground">
			Creditul de ore al fiecărui client: alimentat din facturile plătite (clienții bifați), din
			orele cumpărate pe /servicii și din ajustări manuale. Tarifele de referință se schimbă din
			<a class="underline" href="/{tenantSlug}/settings/hourly-rates">Settings → Tarife orare</a>.
		</p>
	</div>

	<svelte:boundary>
		{#snippet pending()}
			<div class="space-y-4">
				<Skeleton class="h-10 w-full" />
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
</div>
