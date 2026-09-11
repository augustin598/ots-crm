<!--
	Câmpurile de credit de ore ale unui task (spec §6.1): ore estimate, specializare,
	regim. Apar doar când task-ul are client; obligatorii dacă orele > 0. Sub câmp:
	echivalentul ponderat în credit și soldul clientului. Nimic nu blochează crearea.
-->
<script lang="ts">
	import { getHourlyCatalogView } from '$lib/remotes/hourly-rates.remote';
	import { getClientHourCreditView } from '$lib/remotes/hour-credits.remote';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import { weightFactor, weightedMinutes } from '$lib/logic/hour-credits';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';

	let {
		clientId,
		estimatedHours = $bindable(0),
		rateSlug = $bindable(''),
		modeSlug = $bindable('standard'),
		disabled = false
	}: {
		clientId: string | null | undefined;
		estimatedHours: number;
		rateSlug: string;
		modeSlug: string;
		disabled?: boolean;
	} = $props();

	const catalogQuery = getHourlyCatalogView();
	const catalog = $derived(catalogQuery.current);
	const creditQuery = $derived(clientId ? getClientHourCreditView(clientId) : null);
	const credit = $derived(creditQuery?.current ?? null);

	const rate = $derived(catalog?.hourlyRates.find((r) => r.slug === rateSlug) ?? null);
	const mode = $derived(catalog?.rateModes.find((m) => m.slug === modeSlug) ?? null);
	const estimatedMinutes = $derived(Math.max(0, Math.round(Number(estimatedHours) * 60)));
	const weighted = $derived.by(() => {
		if (!rate || !mode || !credit?.reference || estimatedMinutes === 0) return null;
		try {
			return weightedMinutes(
				estimatedMinutes,
				weightFactor(rate.rate, mode.multiplierPct, credit.reference.rateEur)
			);
		} catch {
			return null;
		}
	});
	const overReserve = $derived(
		weighted !== null && credit !== null && weighted > credit.balanceMinutes
	);
</script>

{#if clientId}
	<div class="col-span-2 grid gap-3 rounded-lg border border-dashed p-3 sm:grid-cols-3">
		<div class="space-y-1">
			<Label for="hc-hours">Ore estimate</Label>
			<Input
				id="hc-hours"
				type="number"
				min="0"
				max="999"
				step="0.25"
				bind:value={estimatedHours}
				{disabled}
			/>
		</div>
		<div class="space-y-1">
			<Label for="hc-rate">Specializare</Label>
			<select
				id="hc-rate"
				bind:value={rateSlug}
				{disabled}
				class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
			>
				<option value="">—</option>
				{#each catalog?.hourlyRates ?? [] as r (r.slug)}
					<option value={r.slug}>{r.label} · {r.rate} €/h</option>
				{/each}
			</select>
		</div>
		<div class="space-y-1">
			<Label for="hc-mode">Regim</Label>
			<select
				id="hc-mode"
				bind:value={modeSlug}
				{disabled}
				class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
			>
				{#each catalog?.rateModes ?? [] as m (m.slug)}
					<option value={m.slug}
						>{m.label}{m.multiplierPct > 100 ? ` (+${m.multiplierPct - 100}%)` : ''}</option
					>
				{/each}
			</select>
		</div>
		<p class="text-xs text-muted-foreground sm:col-span-3 {overReserve ? 'text-amber-600' : ''}">
			{#if estimatedMinutes > 0 && !rateSlug}
				Alege specializarea ca orele să fie luate din credit.
			{:else if weighted !== null && credit}
				{formatMinutes(estimatedMinutes)}
				{rate?.label} = {formatMinutes(weighted)} credit · Sold: {formatMinutes(
					credit.balanceMinutes
				)}{overReserve ? ' — peste sold, diferența se va factura la finalizare' : ''}
			{:else if credit}
				Sold client: {formatMinutes(credit.balanceMinutes)}
			{/if}
		</p>
	</div>
{/if}
