<script lang="ts">
	import { page } from '$app/state';
	import {
		adjustHourCredit,
		getClientHourCreditView,
		setClientHourCreditFromInvoices
	} from '$lib/remotes/hour-credits.remote';
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
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import { LEDGER_KIND_LABELS } from '$lib/logic/hour-credits';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { remoteErrorMessage } from '$lib/utils/remote-error';

	let { clientId }: { clientId: string } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const view = $derived(await getClientHourCreditView(clientId));

	let optedIn = $derived(view.optedIn);
	let optError = $state<string | null>(null);
	async function toggleOptIn(enabled: boolean) {
		optError = null;
		try {
			await setClientHourCreditFromInvoices({ clientId, enabled }).updates(
				getClientHourCreditView(clientId)
			);
		} catch (err) {
			optedIn = view.optedIn;
			optError = remoteErrorMessage(err, 'Nu am putut salva bifa.');
		}
	}

	// Ajustare manuală: ore zecimale în UI, minute (multiplu de pas) spre server.
	let adjustHours = $state(1);
	let adjustSign = $state<'+' | '-'>('+');
	let adjustNote = $state('');
	let adjusting = $state(false);
	let adjustError = $state<string | null>(null);
	const adjustMinutes = $derived(
		Math.round(Number(adjustHours) * 60) * (adjustSign === '-' ? -1 : 1)
	);

	async function submitAdjust(e: SubmitEvent) {
		e.preventDefault();
		adjusting = true;
		adjustError = null;
		try {
			await adjustHourCredit({
				clientId,
				deltaMinutes: adjustMinutes,
				note: adjustNote.trim()
			}).updates(getClientHourCreditView(clientId));
			adjustNote = '';
		} catch (err) {
			adjustError = remoteErrorMessage(err, 'Nu am putut ajusta creditul.');
		} finally {
			adjusting = false;
		}
	}

	function fmtDate(d: Date): string {
		return new Date(d).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
	}

	function sourceHref(sourceType: string, sourceId: string): string | null {
		if (sourceType === 'invoice') return `/${tenantSlug}/invoices/${sourceId}`;
		if (sourceType === 'task') return `/${tenantSlug}/tasks/${sourceId}`;
		return null;
	}
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold">Credit de ore · {view.clientName}</h1>
			<p class="text-sm text-muted-foreground">
				<a class="underline" href="/{tenantSlug}/clients/{clientId}">Panoul clientului</a> ·
				<a class="underline" href="/{tenantSlug}/hour-credits">Bugete ore</a>
			</p>
		</div>
		<div class="text-right">
			<p class="text-xs text-muted-foreground">Sold</p>
			<p
				class="text-3xl font-bold {view.balanceMinutes < view.lowCreditThresholdMinutes
					? 'text-red-600'
					: ''}"
			>
				{formatMinutes(view.balanceMinutes)}
			</p>
			<p class="text-xs text-muted-foreground">
				la referința {view.reference
					? `${view.reference.label}, ${view.reference.rateEur} €/h`
					: '—'}
			</p>
		</div>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<Card>
			<CardHeader>
				<CardTitle>Alimentare din facturi</CardTitle>
				<CardDescription>
					Facturile plătite ale clientului (fără hosting, ads, depășiri și comenzi de ore) se
					convertesc în ore la tariful de referință, la cursul BNR din ziua plății.
				</CardDescription>
			</CardHeader>
			<CardContent class="flex items-center justify-between">
				<Label for="optIn">Facturile plătite alimentează creditul de ore</Label>
				<Switch
					id="optIn"
					bind:checked={optedIn}
					onCheckedChange={(v) => toggleOptIn(v)}
					disabled={!view.canEdit}
				/>
			</CardContent>
			{#if optError}
				<p class="px-6 pb-4 text-sm text-red-600">{optError}</p>
			{/if}
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Ajustare manuală</CardTitle>
				<CardDescription
					>Doar owner/admin. Motivul e obligatoriu și rămâne în ledger.</CardDescription
				>
			</CardHeader>
			<CardContent>
				{#if view.canEdit}
					<form onsubmit={submitAdjust} class="space-y-3">
						<div class="flex items-end gap-2">
							<div class="w-20 space-y-1">
								<Label for="adjustSign">Semn</Label>
								<select
									id="adjustSign"
									bind:value={adjustSign}
									class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
								>
									<option value="+">+</option>
									<option value="-">−</option>
								</select>
							</div>
							<div class="w-28 space-y-1">
								<Label for="adjustHours">Ore</Label>
								<Input
									id="adjustHours"
									type="number"
									bind:value={adjustHours}
									min="0.25"
									max="1000"
									step={view.stepMinutes / 60}
									required
								/>
							</div>
							<p class="pb-2 text-xs text-muted-foreground">
								= {adjustSign}{formatMinutes(Math.abs(adjustMinutes))}
							</p>
						</div>
						<div class="space-y-1">
							<Label for="adjustNote">Motiv</Label>
							<Textarea
								id="adjustNote"
								bind:value={adjustNote}
								rows={2}
								minlength={5}
								maxlength={300}
								required
								placeholder="ex. ore incluse în contractul semnat pe 1 septembrie"
							/>
						</div>
						<div class="flex items-center justify-end gap-3">
							{#if adjustError}<p class="text-sm text-red-600">{adjustError}</p>{/if}
							<Button
								type="submit"
								disabled={adjusting || adjustMinutes === 0 || adjustNote.trim().length < 5}
							>
								{adjusting ? 'Se salvează…' : 'Aplică ajustarea'}
							</Button>
						</div>
					</form>
				{:else}
					<p class="text-sm text-muted-foreground">
						Doar owner-ul sau un admin pot ajusta creditul.
					</p>
				{/if}
			</CardContent>
		</Card>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Ledger</CardTitle>
			<CardDescription
				>Toate mișcările, cele mai recente sus. Soldul de mai sus e suma lor.</CardDescription
			>
		</CardHeader>
		<CardContent>
			{#if view.entries.length === 0}
				<p class="text-sm text-muted-foreground">Nicio mișcare încă.</p>
			{:else}
				<div class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Data</TableHead>
								<TableHead>Tip</TableHead>
								<TableHead class="text-right">Minute</TableHead>
								<TableHead>Detalii</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each view.entries as e (e.id)}
								<TableRow>
									<TableCell class="whitespace-nowrap">{fmtDate(e.createdAt)}</TableCell>
									<TableCell
										><Badge variant="outline">{LEDGER_KIND_LABELS[e.kind] ?? e.kind}</Badge
										></TableCell
									>
									<TableCell
										class="text-right font-medium {e.deltaMinutes < 0
											? 'text-red-600'
											: e.deltaMinutes > 0
												? 'text-green-700'
												: ''}"
									>
										{e.deltaMinutes > 0 ? '+' : ''}{formatMinutes(e.deltaMinutes)}
									</TableCell>
									<TableCell class="text-sm">
										{#if sourceHref(e.sourceType, e.sourceId)}
											<a
												class="underline-offset-2 hover:underline"
												href={sourceHref(e.sourceType, e.sourceId)}>{e.note ?? e.sourceId}</a
											>
										{:else}
											{e.note ?? ''}
										{/if}
										{#if e.netCentsSnapshot && e.currencySnapshot}
											<span class="text-xs text-muted-foreground">
												· {formatAmount(e.netCentsSnapshot, e.currencySnapshot as Currency)} net{e.fxRateSnapshot
													? `, curs ${e.fxRateSnapshot}`
													: ''}{e.referenceRateEurSnapshot
													? `, referință ${e.referenceRateEurSnapshot} €/h`
													: ''}
											</span>
										{/if}
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
