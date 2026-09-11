<script lang="ts">
	import { createHourlyRate, getHourlyRatesAdmin } from '$lib/remotes/hourly-rates.remote';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Table, TableBody, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import { Clock, Gauge, Wallet } from '@lucide/svelte';
	import { RATE_EUR_MAX, RATE_EUR_MIN } from '$lib/logic/hourly-catalog';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import RateRow from './RateRow.svelte';
	import ModeRow from './ModeRow.svelte';
	import CreditRulesForm from './CreditRulesForm.svelte';

	const admin = $derived(await getHourlyRatesAdmin());
	const canEdit = $derived(admin.canEdit);

	let newLabel = $state('');
	let newRateEur = $state(60);
	let creating = $state(false);
	let createError = $state<string | null>(null);

	async function handleCreate(e: SubmitEvent) {
		e.preventDefault();
		creating = true;
		createError = null;
		try {
			await createHourlyRate({ label: newLabel.trim(), rateEur: Number(newRateEur) }).updates(
				getHourlyRatesAdmin()
			);
			newLabel = '';
		} catch (err) {
			createError = remoteErrorMessage(err, 'Nu am putut adăuga specializarea.');
		} finally {
			creating = false;
		}
	}
</script>

<div class="space-y-6">
	{#if !canEdit}
		<p class="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
			Poți vedea tarifele, dar doar owner-ul sau un admin le pot modifica.
		</p>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><Clock class="h-5 w-5" /> Specializări</CardTitle>
			<CardDescription>
				Tariful de bază pe oră, fără TVA, în EUR. Slug-ul e fix după creare (ajunge în comenzi și în
				metadata Stripe). Specializările dezactivate dispar de pe /servicii și din formularul de
				task.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Denumire</TableHead>
							<TableHead class="w-28">€/h</TableHead>
							<TableHead class="w-24">Ordine</TableHead>
							<TableHead class="w-44">Slug</TableHead>
							<TableHead class="w-20">Activ</TableHead>
							<TableHead class="w-28 text-right">Acțiuni</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each admin.rates as rate (rate.id)}
							<RateRow {rate} isReference={rate.slug === admin.referenceRateSlug} {canEdit} />
						{/each}
					</TableBody>
				</Table>
			</div>

			{#if canEdit}
				<form onsubmit={handleCreate} class="flex flex-wrap items-end gap-3 rounded-md border p-3">
					<div class="min-w-48 flex-1 space-y-1">
						<Label for="newRateLabel">Specializare nouă</Label>
						<Input
							id="newRateLabel"
							bind:value={newLabel}
							placeholder="ex. QA & Testare"
							required
							minlength={2}
							maxlength={60}
						/>
					</div>
					<div class="w-28 space-y-1">
						<Label for="newRateEur">€/h</Label>
						<Input
							id="newRateEur"
							type="number"
							bind:value={newRateEur}
							min={RATE_EUR_MIN}
							max={RATE_EUR_MAX}
							step="1"
							required
						/>
					</div>
					<Button type="submit" disabled={creating || newLabel.trim().length < 2}>
						{creating ? 'Se adaugă…' : 'Adaugă'}
					</Button>
					{#if createError}
						<p class="basis-full text-sm text-red-600">{createError}</p>
					{/if}
				</form>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Gauge class="h-5 w-5" /> Regimuri de lucru
			</CardTitle>
			<CardDescription>
				Majorarea se aplică pe tariful de bază și se rotunjește la euro întreg. Regimurile nu se
				cumulează. Plafonul de ore limitează o singură comandă online de pe /servicii; nu se aplică
				la task-uri.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="space-y-4">
				{#each admin.modes as mode (mode.id)}
					<ModeRow {mode} {canEdit} />
				{/each}
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Wallet class="h-5 w-5" /> Reguli credit de ore
			</CardTitle>
			<CardDescription>
				Tariful de referință transformă banii facturați în ore de credit și ponderează consumul
				task-urilor. Pragul declanșează alerta „credit scăzut”.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<CreditRulesForm
				rules={admin.rules}
				rates={admin.rates}
				resolvedReferenceSlug={admin.referenceRateSlug}
				{canEdit}
			/>
		</CardContent>
	</Card>
</div>
