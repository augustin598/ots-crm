<script lang="ts">
	import { getHourlyRatesAdmin, updateHourCreditRules } from '$lib/remotes/hourly-rates.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import {
		STEP_MINUTES_OPTIONS,
		formatMinutes,
		type CatalogRate,
		type HourCreditRules
	} from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { onDestroy, untrack } from 'svelte';

	let {
		rules,
		rates,
		resolvedReferenceSlug,
		canEdit
	}: {
		rules: HourCreditRules;
		rates: CatalogRate[];
		resolvedReferenceSlug: string | null;
		canEdit: boolean;
	} = $props();

	const AUTO = '__auto__';

	// Seeded o singură dată, intenționat: un refresh al query-ului (salvarea altui rând)
	// nu trebuie să șteargă ce tastează userul.
	let referenceChoice = $state(untrack(() => rules.referenceRateSlug ?? AUTO));
	let thresholdHours = $state(untrack(() => rules.lowCreditThresholdMinutes / 60));
	let stepMinutes = $state<number>(untrack(() => rules.stepMinutes));
	let notifyEmail = $state(untrack(() => rules.notifyEmail));
	let notifyWhatsapp = $state(untrack(() => rules.notifyWhatsapp));
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => clearTimeout(savedTimer));

	const selectableRates = $derived(rates.filter((r) => r.isActive));
	const resolved = $derived(rates.find((r) => r.slug === resolvedReferenceSlug) ?? null);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = null;
		saved = false;
		try {
			await updateHourCreditRules({
				referenceRateSlug: referenceChoice === AUTO ? null : referenceChoice,
				lowCreditThresholdMinutes: Math.round(Number(thresholdHours) * 60),
				stepMinutes: Number(stepMinutes) as (typeof STEP_MINUTES_OPTIONS)[number],
				notifyEmail,
				notifyWhatsapp
			}).updates(getHourlyRatesAdmin());
			saved = true;
			// Două salvări la mai puțin de 3 s distanță: al doilea „Salvat.” trebuie să stea
			// tot 3 s, nu să fie stins de timerul primei salvări.
			clearTimeout(savedTimer);
			savedTimer = setTimeout(() => {
				saved = false;
			}, 3000);
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva regulile.');
		} finally {
			saving = false;
		}
	}
</script>

<form onsubmit={save} class="space-y-5">
	<div class="grid gap-4 md:grid-cols-3">
		<div class="space-y-1">
			<Label for="referenceRate">Tarif de referință</Label>
			<select
				id="referenceRate"
				bind:value={referenceChoice}
				disabled={!canEdit || saving}
				class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			>
				<option value={AUTO}>Cel mai mic tarif activ</option>
				{#each selectableRates as r (r.id)}
					<option value={r.slug}>{r.label} — {r.rateEur} €/h</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				Acum: {resolved
					? `${resolved.label}, ${resolved.rateEur} €/h`
					: 'nicio specializare activă'}
			</p>
		</div>
		<div class="space-y-1">
			<Label for="thresholdHours">Prag „credit scăzut” (ore)</Label>
			<Input
				id="thresholdHours"
				type="number"
				bind:value={thresholdHours}
				min="0"
				max="1000"
				step="0.25"
				disabled={!canEdit || saving}
			/>
			<p class="text-xs text-muted-foreground">
				= {formatMinutes(Math.round(Number(thresholdHours) * 60))}
			</p>
		</div>
		<div class="space-y-1">
			<Label for="stepMinutes">Pas minim la task</Label>
			<select
				id="stepMinutes"
				bind:value={stepMinutes}
				disabled={!canEdit || saving}
				class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			>
				{#each STEP_MINUTES_OPTIONS as s (s)}
					<option value={s}>{s} minute</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="grid gap-3 md:grid-cols-2">
		<div class="flex items-center justify-between rounded-md border p-3">
			<div>
				<Label for="notifyEmail">Notificări email către client</Label>
				<p class="text-xs text-muted-foreground">
					Credit scăzut, consum la finalizare, alimentări.
				</p>
			</div>
			<Switch id="notifyEmail" bind:checked={notifyEmail} disabled={!canEdit || saving} />
		</div>
		<div class="flex items-center justify-between rounded-md border p-3">
			<div>
				<Label for="notifyWhatsapp">Notificări WhatsApp în grupul task-ului</Label>
				<p class="text-xs text-muted-foreground">
					Aceleași evenimente, doar dacă există grup legat.
				</p>
			</div>
			<Switch id="notifyWhatsapp" bind:checked={notifyWhatsapp} disabled={!canEdit || saving} />
		</div>
	</div>

	<div class="flex items-center justify-end gap-3">
		{#if error}
			<p class="text-sm text-red-600">{error}</p>
		{:else if saved}
			<p class="text-sm text-green-600">Salvat.</p>
		{/if}
		<Button type="submit" disabled={!canEdit || saving}>
			{saving ? 'Se salvează…' : 'Salvează regulile'}
		</Button>
	</div>
</form>
