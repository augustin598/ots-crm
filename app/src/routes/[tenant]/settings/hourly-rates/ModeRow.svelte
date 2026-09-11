<script lang="ts">
	import { getHourlyRatesAdmin, updateRateMode } from '$lib/remotes/hourly-rates.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		MAX_HOURS_MAX,
		MAX_HOURS_MIN,
		MULTIPLIER_PCT_MAX,
		MULTIPLIER_PCT_MIN,
		type CatalogMode
	} from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { untrack } from 'svelte';

	let { mode, canEdit }: { mode: CatalogMode; canEdit: boolean } = $props();

	const isStandard = $derived(mode.slug === 'standard');

	let label = $state(untrack(() => mode.label));
	let suffix = $state(untrack(() => mode.suffix));
	let description = $state(untrack(() => mode.description));
	let sla = $state(untrack(() => mode.sla));
	let multiplierPct = $state(untrack(() => mode.multiplierPct));
	let maxHours = $state(untrack(() => mode.maxHours));
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Switch-ul bits-ui își ține propriul `checked` la click. Fără oglinda asta locală,
	// un refuz al serverului (regimul standard nu se dezactivează) lăsa butonul în
	// poziția greșită până la reîncărcarea paginii.
	let activeLocal = $state(untrack(() => mode.isActive));
	$effect(() => {
		activeLocal = mode.isActive;
	});

	const dirty = $derived(
		label.trim() !== mode.label ||
			suffix.trim() !== mode.suffix ||
			description.trim() !== mode.description ||
			sla.trim() !== mode.sla ||
			Number(multiplierPct) !== mode.multiplierPct ||
			Number(maxHours) !== mode.maxHours
	);

	const idBase = $derived(`mode-${mode.slug}`);

	async function save(isActive: boolean = mode.isActive) {
		saving = true;
		error = null;
		try {
			await updateRateMode({
				slug: mode.slug,
				label: label.trim(),
				suffix: suffix.trim(),
				description: description.trim(),
				sla: sla.trim(),
				multiplierPct: Number(multiplierPct),
				maxHours: Number(maxHours),
				isActive
			}).updates(getHourlyRatesAdmin());
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva regimul.');
			activeLocal = mode.isActive;
		} finally {
			saving = false;
		}
	}
</script>

<div class="rounded-md border p-4 {mode.isActive ? '' : 'opacity-60'}">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<code class="text-xs text-muted-foreground">{mode.slug}</code>
			{#if isStandard}
				<span class="text-xs text-muted-foreground">(ancora grilei: 100%, mereu activ)</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<Label for="{idBase}-active" class="text-sm">Activ</Label>
			<Switch
				id="{idBase}-active"
				bind:checked={activeLocal}
				onCheckedChange={(v) => save(v)}
				disabled={!canEdit || saving || isStandard}
			/>
		</div>
	</div>

	<div class="grid gap-3 md:grid-cols-4">
		<div class="space-y-1">
			<Label for="{idBase}-label">Denumire</Label>
			<Input id="{idBase}-label" bind:value={label} disabled={!canEdit || saving} maxlength={60} />
		</div>
		<div class="space-y-1">
			<Label for="{idBase}-suffix">Sufix pe factură</Label>
			<Input
				id="{idBase}-suffix"
				bind:value={suffix}
				disabled={!canEdit || saving || isStandard}
				maxlength={40}
				placeholder="ex. Urgență 48h"
			/>
		</div>
		<div class="space-y-1">
			<Label for="{idBase}-mult">Multiplicator %</Label>
			<Input
				id="{idBase}-mult"
				type="number"
				bind:value={multiplierPct}
				min={MULTIPLIER_PCT_MIN}
				max={MULTIPLIER_PCT_MAX}
				step="1"
				disabled={!canEdit || saving || isStandard}
			/>
		</div>
		<div class="space-y-1">
			<Label for="{idBase}-max">Plafon ore / comandă</Label>
			<Input
				id="{idBase}-max"
				type="number"
				bind:value={maxHours}
				min={MAX_HOURS_MIN}
				max={MAX_HOURS_MAX}
				step="1"
				disabled={!canEdit || saving}
			/>
		</div>
		<div class="space-y-1 md:col-span-2">
			<Label for="{idBase}-desc">Descriere (sub selector, pe /servicii)</Label>
			<Textarea
				id="{idBase}-desc"
				bind:value={description}
				disabled={!canEdit || saving}
				maxlength={300}
				rows={2}
			/>
		</div>
		<div class="space-y-1 md:col-span-2">
			<Label for="{idBase}-sla">SLA (se îngheață pe comandă la plată)</Label>
			<Textarea
				id="{idBase}-sla"
				bind:value={sla}
				disabled={!canEdit || saving}
				maxlength={300}
				rows={2}
			/>
		</div>
	</div>

	<div class="mt-3 flex items-center justify-end gap-3">
		{#if error}
			<p class="text-xs text-red-600">{error}</p>
		{/if}
		<Button
			size="sm"
			variant="outline"
			onclick={() => save()}
			disabled={!canEdit || saving || !dirty}
		>
			{saving ? '…' : 'Salvează'}
		</Button>
	</div>
</div>
