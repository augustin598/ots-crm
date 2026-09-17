<!--
	Cardul „Credit ore" din pagina task-ului: estimare, ore efective, specializare,
	regim, ce s-a decontat din credit și unde a ajuns depășirea.
-->
<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import Info from '@lucide/svelte/icons/info';
	import {
		Tooltip,
		TooltipContent,
		TooltipProvider,
		TooltipTrigger
	} from '$lib/components/ui/tooltip';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import HcRatePill from '$lib/components/hour-credits/HcRatePill.svelte';
	import '$lib/components/hour-credits/hour-credits.css';

	let {
		task,
		tenantSlug
	}: {
		task: {
			id: string;
			status: string;
			clientId: string | null;
			estimatedMinutes: number | null;
			actualMinutes: number | null;
			rateSlug: string | null;
			modeSlug: string | null;
			creditSettledAt: Date | null;
			overageInvoiceId: string | null;
		};
		tenantSlug: string;
	} = $props();
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			Credit ore
			<TooltipProvider delayDuration={150}>
				<Tooltip>
					<TooltipTrigger>
						{#if task.creditSettledAt}
							<span class="hc-state hc-state-done">
								decontat
								<Info class="h-3 w-3 opacity-80" />
							</span>
						{:else}
							<span class="hc-state hc-state-held">
								rezervat
								<Info class="h-3 w-3 opacity-80" />
							</span>
						{/if}
					</TooltipTrigger>
					<TooltipContent class="max-w-xs text-xs">
						{#if task.creditSettledAt}
							Orele au fost deja scăzute din creditul clientului, la trecerea taskului în Done.
						{:else}
							Estimarea blochează credit din soldul clientului, dar încă nu s-a scăzut nimic.
							Scăderea se face la trecerea în Done, pe orele efective.
						{/if}
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</CardTitle>
	</CardHeader>
	<CardContent class="space-y-2 text-sm">
		<div class="flex justify-between">
			<span class="text-muted-foreground">Ore estimate</span>
			<span>{formatMinutes(task.estimatedMinutes ?? 0)}</span>
		</div>
		<div class="flex justify-between">
			<span class="text-muted-foreground">Ore efective</span>
			<span>{task.actualMinutes ? formatMinutes(task.actualMinutes) : '—'}</span>
		</div>
		<div class="flex items-center justify-between gap-2">
			<span class="text-muted-foreground">Specializare și regim</span>
			<span class="flex flex-wrap items-center justify-end gap-1.5">
				<HcRatePill slug={task.rateSlug} />
				<HcRatePill slug={task.modeSlug ?? 'standard'} kind="mode" />
			</span>
		</div>
		{#if task.creditSettledAt}
			<p class="text-xs text-muted-foreground">
				Decontat la {new Date(task.creditSettledAt).toLocaleString('ro-RO', {
					dateStyle: 'short',
					timeStyle: 'short'
				})}.
				{#if task.overageInvoiceId}
					Timpul peste credit e facturat în ore întregi, în
					<a class="underline" href="/{tenantSlug}/invoices/{task.overageInvoiceId}"
						>draftul lunar de depășire</a
					>; ce rămâne din ora facturată a intrat în credit.
				{:else}
					Totul a intrat în credit.
				{/if}
			</p>
		{:else}
			<p class="text-xs text-muted-foreground">
				Scăderea se face la finalizare, pe orele efective. Fără ore efective, taskul rămâne
				nedecontat până le completezi.
			</p>
		{/if}
		{#if task.clientId}
			<a class="text-xs underline" href="/{tenantSlug}/hour-credits/{task.clientId}"
				>Creditul clientului</a
			>
		{/if}
	</CardContent>
</Card>
