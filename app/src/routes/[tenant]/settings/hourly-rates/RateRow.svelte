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

	let label = $state(untrack(() => rate.label));
	let rateEur = $state(untrack(() => rate.rateEur));
	let sortOrder = $state(untrack(() => rate.sortOrder));
	let saving = $state(false);
	let error = $state<string | null>(null);

	const dirty = $derived(
		label.trim() !== rate.label ||
			Number(rateEur) !== rate.rateEur ||
			Number(sortOrder) !== rate.sortOrder
	);

	async function save(isActive: boolean = rate.isActive) {
		saving = true;
		error = null;
		try {
			await updateHourlyRate({
				id: rate.id,
				label: label.trim(),
				rateEur: Number(rateEur),
				sortOrder: Number(sortOrder),
				isActive
			}).updates(getHourlyRatesAdmin());
			label = label.trim();
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut salva specializarea.');
		} finally {
			saving = false;
		}
	}
</script>

<TableRow class={rate.isActive ? '' : 'opacity-60'}>
	<TableCell>
		<Input bind:value={label} disabled={!canEdit || saving} maxlength={60} aria-label="Denumire" />
	</TableCell>
	<TableCell>
		<Input
			type="number"
			bind:value={rateEur}
			min={RATE_EUR_MIN}
			max={RATE_EUR_MAX}
			step="1"
			disabled={!canEdit || saving}
			aria-label="Tarif €/h"
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
			aria-label="Ordine"
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
			checked={rate.isActive}
			onCheckedChange={(v) => save(v)}
			disabled={!canEdit || saving}
			aria-label="Activ"
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
