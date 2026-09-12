<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { creditInvoiceNow, getHourCreditsPage } from '$lib/remotes/hour-credits.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Label } from '$lib/components/ui/label';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { formatMinutes } from '$lib/logic/hourly-catalog';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { remoteErrorMessage } from '$lib/utils/remote-error';

	const tenantSlug = $derived(page.params.tenant);
	const data = $derived(await getHourCreditsPage());

	let filter = $state<'all' | 'opted' | 'low'>('all');
	const rows = $derived(
		data.rows.filter((r) =>
			filter === 'opted'
				? r.optedIn
				: filter === 'low'
					? r.balanceMinutes < data.lowCreditThresholdMinutes
					: true
		)
	);

	// Selectorul „deschide creditul unui client": din pagina asta trebuie să poți
	// ajunge la ORICE client, nu doar la cei care au deja mișcări în ledger.
	const clientsQuery = getClients();
	const clients = $derived(
		[...(clientsQuery.current ?? [])]
			.map((c) => ({ id: c.id as string, name: (c.name as string) ?? '' }))
			.sort((a, b) => a.name.localeCompare(b.name, 'ro'))
	);
	let pickedClientId = $state('');
	function openPicked() {
		if (pickedClientId) goto(`/${tenantSlug}/hour-credits/${pickedClientId}`);
	}

	let creditingId = $state<string | null>(null);
	let creditError = $state<string | null>(null);

	async function creditNow(invoiceId: string) {
		creditingId = invoiceId;
		creditError = null;
		try {
			await creditInvoiceNow({ invoiceId }).updates(getHourCreditsPage());
		} catch (err) {
			creditError = remoteErrorMessage(err, 'Nu am putut credita factura.');
		} finally {
			creditingId = null;
		}
	}

	async function refresh() {
		await getHourCreditsPage().refresh();
	}

	function fmtDate(d: Date | null): string {
		return d ? new Date(d).toLocaleDateString('ro-RO') : '—';
	}
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="text-sm text-muted-foreground">
			Tarif de referință:
			{#if data.reference}
				<strong>{data.reference.label}, {data.reference.rateEur} €/h</strong>
			{:else}
				<strong>nicio specializare activă</strong>
			{/if}
			· prag credit scăzut: <strong>{formatMinutes(data.lowCreditThresholdMinutes)}</strong>
		</div>
		<div class="flex items-center gap-2">
			<Button
				size="sm"
				variant={filter === 'all' ? 'default' : 'outline'}
				onclick={() => (filter = 'all')}>Toți</Button
			>
			<Button
				size="sm"
				variant={filter === 'opted' ? 'default' : 'outline'}
				onclick={() => (filter = 'opted')}>Cu alimentare din facturi</Button
			>
			<Button
				size="sm"
				variant={filter === 'low' ? 'default' : 'outline'}
				onclick={() => (filter = 'low')}>Sub prag</Button
			>
			<Button size="sm" variant="ghost" onclick={refresh}>Refresh</Button>
		</div>
	</div>

	<div class="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
		<div class="min-w-64 flex-1 space-y-1">
			<Label for="pickClient">Deschide creditul unui client</Label>
			<select
				id="pickClient"
				bind:value={pickedClientId}
				class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			>
				<option value="">Alege un client…</option>
				{#each clients as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
		</div>
		<Button onclick={openPicked} disabled={!pickedClientId}>Deschide</Button>
		<p class="basis-full text-xs text-muted-foreground">
			În pagina clientului bifezi „Facturile plătite alimentează creditul" și poți adăuga ore
			manual, cu motiv.
		</p>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Clienți</CardTitle>
			<CardDescription>
				Apar clienții bifați pentru alimentare din facturi și cei cu sold sau mișcări în ledger.
				Rezervate = estimările task-urilor deschise, ponderate; disponibil = sold − rezervate.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if rows.length === 0}
				<p class="text-sm text-muted-foreground">
					Niciun client cu credit de ore încă. Alege un client în selectorul de mai sus, apoi
					bifează „Facturile plătite alimentează creditul" sau adaugă ore manual.
				</p>
			{:else}
				<div class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Client</TableHead>
								<TableHead class="text-right">Sold</TableHead>
								<TableHead class="text-right">Rezervate</TableHead>
								<TableHead class="text-right">Disponibil</TableHead>
								<TableHead class="text-right">Consum luna curentă</TableHead>
								<TableHead>Ultima alimentare</TableHead>
								<TableHead>Alimentare din facturi</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each rows as r (r.clientId)}
								<TableRow>
									<TableCell>
										<a
											class="font-medium underline-offset-2 hover:underline"
											href="/{tenantSlug}/hour-credits/{r.clientId}"
										>
											{r.clientName}
										</a>
									</TableCell>
									<TableCell class="text-right">
										<span
											class={r.balanceMinutes < data.lowCreditThresholdMinutes
												? 'font-semibold text-red-600'
												: 'font-semibold'}
										>
											{formatMinutes(r.balanceMinutes)}
										</span>
										{#if r.balanceMinutes < data.lowCreditThresholdMinutes}
											<Badge variant="destructive" class="ml-2">sub prag</Badge>
										{/if}
									</TableCell>
									<TableCell class="text-right">{formatMinutes(r.reservedMinutes)}</TableCell>
									<TableCell
										class="text-right {r.balanceMinutes - r.reservedMinutes < 0
											? 'text-amber-600'
											: ''}"
									>
										{formatMinutes(r.balanceMinutes - r.reservedMinutes)}
									</TableCell>
									<TableCell class="text-right"
										>{formatMinutes(r.consumedThisMonthMinutes)}</TableCell
									>
									<TableCell>
										{fmtDate(r.lastCreditAt)}
										{#if r.lastCreditMinutes !== null}
											<span class="text-xs text-muted-foreground"
												>(+{formatMinutes(r.lastCreditMinutes)})</span
											>
										{/if}
									</TableCell>
									<TableCell>
										{#if r.optedIn}
											<Badge variant="outline">da</Badge>
										{:else}
											<span class="text-xs text-muted-foreground">nu</span>
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

	<Card>
		<CardHeader>
			<CardTitle>Facturi plătite necreditate</CardTitle>
			<CardDescription>
				Facturi plătite ale clienților bifați care nu au încă rând în ledger (plătite înainte de
				bifare, curs BNR indisponibil sau monedă neacceptată). Creditarea e idempotentă.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if creditError}
				<p class="mb-3 text-sm text-red-600">{creditError}</p>
			{/if}
			{#if data.uncredited.length === 0}
				<p class="text-sm text-muted-foreground">Nimic de creditat.</p>
			{:else}
				<div class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Factură</TableHead>
								<TableHead>Client</TableHead>
								<TableHead class="text-right">Net</TableHead>
								<TableHead>Plătită la</TableHead>
								<TableHead>Motiv</TableHead>
								<TableHead class="text-right">Acțiune</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each data.uncredited as inv (inv.invoiceId)}
								<TableRow>
									<TableCell>
										<a
											class="underline-offset-2 hover:underline"
											href="/{tenantSlug}/invoices/{inv.invoiceId}"
										>
											{inv.invoiceNumber ?? inv.invoiceId}
										</a>
									</TableCell>
									<TableCell>{inv.clientName}</TableCell>
									<TableCell class="text-right"
										>{formatAmount(inv.amount, inv.currency as Currency)}</TableCell
									>
									<TableCell>{fmtDate(inv.paidDate)}</TableCell>
									<TableCell class="text-xs text-muted-foreground"
										>{inv.reason ?? 'plătită înainte de bifare'}</TableCell
									>
									<TableCell class="text-right">
										{#if data.canEdit && !inv.reason}
											<Button
												size="sm"
												variant="outline"
												disabled={creditingId === inv.invoiceId}
												onclick={() => creditNow(inv.invoiceId)}
											>
												{creditingId === inv.invoiceId ? '…' : 'Creditează'}
											</Button>
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
