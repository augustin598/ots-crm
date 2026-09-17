<!--
	Câmpurile de credit de ore ale unui task (spec §6.1): ore estimate, specializare,
	regim. Apar doar când task-ul are client; obligatorii dacă orele > 0. Sub câmp:
	orele rezervate din credit (ore reale) și soldul clientului. Nimic nu blochează crearea.
-->
<script lang="ts">
	import { getHourlyCatalogView } from '$lib/remotes/hourly-rates.remote';
	import { getClientHourCreditView } from '$lib/remotes/hour-credits.remote';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import { availableForTask, ceilToStep } from '$lib/logic/hour-credits';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';

	let {
		clientId,
		taskId = null,
		estimatedHours = $bindable(0),
		rateSlug = $bindable(''),
		modeSlug = $bindable('standard'),
		disabled = false
	}: {
		clientId: string | null | undefined;
		/** La editare: rezervarea taskului însuși nu se scade de două ori din disponibil. */
		taskId?: string | null;
		estimatedHours: number;
		rateSlug: string;
		modeSlug: string;
		disabled?: boolean;
	} = $props();

	const catalogQuery = getHourlyCatalogView();
	const catalog = $derived(catalogQuery.current);
	const creditQuery = $derived(clientId ? getClientHourCreditView(clientId) : null);
	const credit = $derived(creditQuery?.current ?? null);

	const estimatedMinutes = $derived(Math.max(0, Math.round(Number(estimatedHours) * 60)));
	const stepMinutes = $derived(credit?.stepMinutes ?? 15);

	/** Ce rezervă deja taskul editat (dacă e deschis), în ore reale ca pe server. */
	const ownReserved = $derived.by(() => {
		if (!taskId || !credit) return 0;
		const own = credit.tasks.find((t) => t.id === taskId);
		if (!own?.estimatedMinutes || own.creditSettledAt) return 0;
		if (own.status === 'done' || own.status === 'cancelled') return 0;
		return own.estimatedMinutes;
	});
	const available = $derived(
		credit
			? availableForTask({
					balanceMinutes: credit.balanceMinutes,
					reservedMinutes: credit.reservedMinutes,
					ownReservedMinutes: ownReserved
				})
			: null
	);
	// Spec §6.1: galben când estimarea trece de DISPONIBIL, nu de sold.
	const overReserve = $derived(
		!!rateSlug && estimatedMinutes > 0 && available !== null && estimatedMinutes > available
	);

	/** Estimarea se păstrează în multipli de pas (spec §6.1). */
	function snapToStep() {
		const minutes = Math.max(0, Number(estimatedHours) * 60);
		if (!Number.isFinite(minutes)) return;
		estimatedHours = ceilToStep(minutes, stepMinutes) / 60;
	}
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
				step={stepMinutes / 60}
				bind:value={estimatedHours}
				onblur={snapToStep}
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
			{:else if rateSlug && estimatedMinutes > 0 && credit}
				Sold: {formatMinutes(credit.balanceMinutes)} · Disponibil: {formatMinutes(
					available ?? credit.balanceMinutes
				)}{overReserve ? ' — peste disponibil, diferența se va factura la finalizare' : ''}
			{:else if credit}
				Sold client: {formatMinutes(credit.balanceMinutes)}
			{/if}
		</p>
	</div>
{/if}
