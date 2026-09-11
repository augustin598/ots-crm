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

	type ModeFields = {
		label: string;
		suffix: string;
		description: string;
		sla: string;
		multiplierPct: number;
		maxHours: number;
	};

	const SUFFIX_MAX_LENGTH = 40;
	const TEXT_MAX_LENGTH = 300;

	const isStandard = $derived(mode.slug === 'standard');

	// Seeded o singură dată, intenționat: un refresh al query-ului (salvarea altui rând)
	// nu trebuie să șteargă ce tastează userul.
	let label = $state(untrack(() => mode.label));
	let suffix = $state(untrack(() => mode.suffix));
	let description = $state(untrack(() => mode.description));
	let sla = $state(untrack(() => mode.sla));
	let multiplierPct = $state(untrack(() => mode.multiplierPct));
	let maxHours = $state(untrack(() => mode.maxHours));
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Switch-ul bits-ui își ține propriul `checked` la click. Derived scriibil: click-ul îl
	// suprascrie optimist, `catch` îl dă înapoi la refuzul serverului, iar o salvare reușită
	// îl resincronizează singură când se reîmprospătează `mode`.
	let activeLocal = $derived(mode.isActive);

	// Toggle-ul de „Activ” schimbă doar statusul: trimite valorile de pe server, nu
	// bufferele de editare pe care userul nu le-a salvat încă.
	const serverFields: ModeFields = $derived({
		label: mode.label,
		suffix: mode.suffix,
		description: mode.description,
		sla: mode.sla,
		multiplierPct: mode.multiplierPct,
		maxHours: mode.maxHours
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

	// Regimul nu stă într-un <form>, deci browserul nu impune min/max/step de pe input-uri.
	// Fără verificarea asta, o valoare greșită ajunge la valibot și userul vede „Bad Request”.
	function validate(fields: ModeFields): string | null {
		if (fields.label.length < 2 || fields.label.length > 60) {
			return 'Denumirea trebuie să aibă între 2 și 60 de caractere.';
		}
		if (fields.suffix.length > SUFFIX_MAX_LENGTH) {
			return `Sufixul de pe factură are maximum ${SUFFIX_MAX_LENGTH} de caractere.`;
		}
		if (
			!Number.isInteger(fields.multiplierPct) ||
			fields.multiplierPct < MULTIPLIER_PCT_MIN ||
			fields.multiplierPct > MULTIPLIER_PCT_MAX
		) {
			return `Multiplicatorul trebuie să fie un procent întreg între ${MULTIPLIER_PCT_MIN} și ${MULTIPLIER_PCT_MAX}.`;
		}
		if (
			!Number.isInteger(fields.maxHours) ||
			fields.maxHours < MAX_HOURS_MIN ||
			fields.maxHours > MAX_HOURS_MAX
		) {
			return `Plafonul de ore trebuie să fie un număr întreg între ${MAX_HOURS_MIN} și ${MAX_HOURS_MAX}.`;
		}
		if (fields.description.length > TEXT_MAX_LENGTH) {
			return `Descrierea are maximum ${TEXT_MAX_LENGTH} de caractere.`;
		}
		if (fields.sla.length > TEXT_MAX_LENGTH) {
			return `SLA-ul are maximum ${TEXT_MAX_LENGTH} de caractere.`;
		}
		return null;
	}

	async function save(
		isActive: boolean = mode.isActive,
		fields: ModeFields = {
			label: label.trim(),
			suffix: suffix.trim(),
			description: description.trim(),
			sla: sla.trim(),
			multiplierPct: Number(multiplierPct),
			maxHours: Number(maxHours)
		}
	) {
		const problem = validate(fields);
		if (problem) {
			error = problem;
			return;
		}
		saving = true;
		error = null;
		try {
			await updateRateMode({ slug: mode.slug, ...fields, isActive }).updates(getHourlyRatesAdmin());
			label = label.trim();
			suffix = suffix.trim();
			description = description.trim();
			sla = sla.trim();
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
				onCheckedChange={(v) => save(v, serverFields)}
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
				maxlength={SUFFIX_MAX_LENGTH}
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
				maxlength={TEXT_MAX_LENGTH}
				rows={2}
			/>
		</div>
		<div class="space-y-1 md:col-span-2">
			<Label for="{idBase}-sla">SLA (se îngheață pe comandă la plată)</Label>
			<Textarea
				id="{idBase}-sla"
				bind:value={sla}
				disabled={!canEdit || saving}
				maxlength={TEXT_MAX_LENGTH}
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
