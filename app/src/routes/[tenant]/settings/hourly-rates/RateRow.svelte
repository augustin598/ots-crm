<script lang="ts">
	import { getHourlyRatesAdmin, updateHourlyRate } from '$lib/remotes/hourly-rates.remote';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { TableCell, TableRow } from '$lib/components/ui/table';
	import { RATE_EUR_MAX, RATE_EUR_MIN, type CatalogRate } from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { untrack } from 'svelte';

	let {
		rate,
		isReference,
		canEdit
	}: { rate: CatalogRate; isReference: boolean; canEdit: boolean } = $props();

	type RateFields = { label: string; rateEur: number; sortOrder: number };

	// Seeded o singură dată, intenționat: un refresh al query-ului (salvarea altui rând)
	// nu trebuie să șteargă ce tastează userul.
	let label = $state(untrack(() => rate.label));
	let rateEur = $state(untrack(() => rate.rateEur));
	let sortOrder = $state(untrack(() => rate.sortOrder));
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Switch-ul bits-ui își ține propriul `checked` la click. Derived scriibil: click-ul îl
	// suprascrie optimist, `catch` îl dă înapoi la refuzul serverului, iar o salvare reușită
	// îl resincronizează singură când se reîmprospătează `rate`.
	let activeLocal = $derived(rate.isActive);

	// Toggle-ul de „Activ” schimbă doar statusul: trimite valorile de pe server, nu
	// bufferele de editare pe care userul nu le-a salvat încă.
	const serverFields: RateFields = $derived({
		label: rate.label,
		rateEur: rate.rateEur,
		sortOrder: rate.sortOrder
	});

	const dirty = $derived(
		label.trim() !== rate.label ||
			Number(rateEur) !== rate.rateEur ||
			Number(sortOrder) !== rate.sortOrder
	);

	// Rândul nu stă într-un <form>, deci browserul nu impune min/max/step de pe input-uri.
	// Fără verificarea asta, o valoare greșită ajunge la valibot și userul vede „Bad Request”.
	function validate(fields: RateFields): string | null {
		if (fields.label.length < 2 || fields.label.length > 60) {
			return 'Denumirea trebuie să aibă între 2 și 60 de caractere.';
		}
		if (
			!Number.isInteger(fields.rateEur) ||
			fields.rateEur < RATE_EUR_MIN ||
			fields.rateEur > RATE_EUR_MAX
		) {
			return `Tariful trebuie să fie un număr întreg între ${RATE_EUR_MIN} și ${RATE_EUR_MAX} €/h.`;
		}
		if (!Number.isInteger(fields.sortOrder) || fields.sortOrder < 0 || fields.sortOrder > 999) {
			return 'Ordinea trebuie să fie un număr întreg între 0 și 999.';
		}
		return null;
	}

	async function save(
		isActive: boolean = rate.isActive,
		fields: RateFields = {
			label: label.trim(),
			rateEur: Number(rateEur),
			sortOrder: Number(sortOrder)
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
			await updateHourlyRate({ id: rate.id, ...fields, isActive }).updates(getHourlyRatesAdmin());
			label = label.trim();
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva specializarea.');
			activeLocal = rate.isActive;
		} finally {
			saving = false;
		}
	}
</script>

<TableRow class={rate.isActive ? '' : 'opacity-60'}>
	<TableCell>
		<Input
			bind:value={label}
			class="min-w-44"
			disabled={!canEdit || saving}
			maxlength={60}
			aria-label="Denumire {rate.label}"
		/>
	</TableCell>
	<TableCell>
		<Input
			type="number"
			bind:value={rateEur}
			min={RATE_EUR_MIN}
			max={RATE_EUR_MAX}
			step="1"
			disabled={!canEdit || saving}
			aria-label="Tarif €/h {rate.label}"
		/>
	</TableCell>
	<TableCell>
		<Input
			type="number"
			bind:value={sortOrder}
			min="0"
			max="999"
			step="1"
			disabled={!canEdit || saving}
			aria-label="Ordine {rate.label}"
		/>
	</TableCell>
	<TableCell>
		<code class="text-xs text-muted-foreground">{rate.slug}</code>
		{#if isReference}
			<Badge variant="outline" class="ml-2">referință</Badge>
		{/if}
	</TableCell>
	<TableCell>
		<Switch
			bind:checked={activeLocal}
			onCheckedChange={(v) => save(v, serverFields)}
			disabled={!canEdit || saving}
			aria-label="Activ {rate.label}"
		/>
	</TableCell>
	<TableCell class="text-right">
		<Button
			size="sm"
			variant="outline"
			onclick={() => save()}
			disabled={!canEdit || saving || !dirty}
		>
			{saving ? '…' : 'Salvează'}
		</Button>
		{#if error}
			<p class="mt-1 text-xs text-red-600">{error}</p>
		{/if}
	</TableCell>
</TableRow>
