<!--
	Cardul „Credit timp" din panoul clientului: sold + ultima mișcare + link spre
	ledger-ul din Bugete ore. `.current` (nu `await`): pagina clientului nu are
	boundary și încarcă mai multe query-uri independent.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getClientHourCreditView } from '$lib/remotes/hour-credits.remote';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Hourglass } from '@lucide/svelte';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import { LEDGER_KIND_LABELS } from '$lib/logic/hour-credits';

	let { clientId }: { clientId: string } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const query = $derived(getClientHourCreditView(clientId));
	const view = $derived(query.current);
	const last = $derived(view?.entries[0] ?? null);
</script>

<Card class="p-4">
	<div class="flex items-center gap-3">
		<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
			<Hourglass class="h-6 w-6 text-amber-600" />
		</div>
		<div class="min-w-0 flex-1">
			<p class="text-sm text-muted-foreground">Credit timp</p>
			{#if view}
				<p
					class="text-2xl font-bold {view.balanceMinutes < view.lowCreditThresholdMinutes
						? 'text-red-600'
						: ''}"
				>
					{formatMinutes(view.balanceMinutes)}
				</p>
				<p class="mt-1 truncate text-xs text-muted-foreground">
					{#if last}
						{LEDGER_KIND_LABELS[last.kind] ?? last.kind}: {last.deltaMinutes > 0
							? '+'
							: ''}{formatMinutes(last.deltaMinutes)}
					{:else}
						nicio mișcare încă
					{/if}
					{#if view.optedIn}
						<Badge variant="outline" class="ml-1">din facturi</Badge>
					{/if}
				</p>
				<a class="text-xs underline" href="/{tenantSlug}/hour-credits/{clientId}"
					>Ledger și ajustări</a
				>
			{:else}
				<p class="text-2xl font-bold">—</p>
			{/if}
		</div>
	</div>
</Card>
