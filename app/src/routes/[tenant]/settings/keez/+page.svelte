<script lang="ts">
	import {
		getKeezStatus,
		connectKeez,
		disconnectKeez,
		syncInvoicesFromKeez,
		importClientsFromKeez,
		getKeezSyncHistory
	} from '$lib/remotes/keez.remote';
	import { getInvoiceSettings, updateInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { CheckCircle2, XCircle, Link as LinkIcon, Download, AlertTriangle } from '@lucide/svelte';
	import { extractErrorMessage } from '$lib/utils';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getKeezStatus();
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	const syncHistoryQuery = getKeezSyncHistory();
	const syncHistory = $derived(syncHistoryQuery.current ?? []);

	// Invoice settings: hosting series, zero-VAT, strict BNR. Migrated from /settings/whmcs.
	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	let clientEid = $state('');
	let applicationId = $state('');
	let secret = $state('');
	let connecting = $state(false);
	let disconnecting = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);
	let successTimer: ReturnType<typeof setTimeout> | null = null;

	// Hosting series state (DA recurring renewals use this when configured).
	let keezSeriesHosting = $state('');
	let keezStartNumberHosting = $state('');
	let savingHostingSeries = $state(false);

	// Zero-VAT compliance state (applies to all Keez-routed invoices when auto-detect is on).
	let zeroVatAutoDetect = $state(true);
	let zeroVatNoteIntracom = $state('');
	let zeroVatNoteExport = $state('');
	let strictBnrConversion = $state(true);
	let savingZeroVatSettings = $state(false);

	// Populate form state once settings load. Re-runs if settings refresh (e.g., after save).
	$effect(() => {
		if (invoiceSettings) {
			keezSeriesHosting = invoiceSettings.keezSeriesHosting ?? '';
			keezStartNumberHosting = invoiceSettings.keezStartNumberHosting ?? '';
			zeroVatAutoDetect = invoiceSettings.whmcsZeroVatAutoDetect ?? true;
			zeroVatNoteIntracom = invoiceSettings.whmcsZeroVatNoteIntracom ?? '';
			zeroVatNoteExport = invoiceSettings.whmcsZeroVatNoteExport ?? '';
			strictBnrConversion = invoiceSettings.whmcsStrictBnrConversion ?? true;
		}
	});

	function showSuccess(durationMs = 3000) {
		success = true;
		if (successTimer) clearTimeout(successTimer);
		successTimer = setTimeout(() => { success = false; }, durationMs);
	}

	const credentialsCorrupt = $derived(
		status?.connected && status?.credentialsValid === false
	);

	// Pre-fill fields when credentials are corrupt so user only needs to re-enter secret
	$effect(() => {
		if (credentialsCorrupt && status) {
			clientEid = status.clientEid || '';
			applicationId = status.applicationId || '';
		}
	});

	// Import states
	let importingClients = $state(false);
	let syncingInvoices = $state(false);
	let importResult = $state<{ imported: number; updated?: number; skipped: number } | null>(null);
	let importError = $state<string | null>(null);

	async function handleConnect() {
		if (!clientEid || !applicationId || !secret) {
			error = 'Client EID, Application ID, and Secret are required';
			return;
		}

		connecting = true;
		error = null;
		success = false;

		try {
			await connectKeez({ clientEid, applicationId, secret }).updates(statusQuery);
			clientEid = '';
			applicationId = '';
			secret = '';
			showSuccess();
		} catch (e) {
			error = extractErrorMessage(e, 'Failed to connect to Keez');
		} finally {
			connecting = false;
		}
	}

	async function handleDisconnect() {
		if (!confirm('Sigur doriți să deconectați Keez? Sincronizarea automată va fi oprită.')) {
			return;
		}

		disconnecting = true;
		error = null;

		try {
			await disconnectKeez().updates(statusQuery);
			showSuccess();
		} catch (e) {
			error = extractErrorMessage(e, 'Failed to disconnect Keez');
		} finally {
			disconnecting = false;
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return 'Never';
		return new Date(date).toLocaleString();
	}

	async function handleImportClients() {
		importingClients = true;
		importError = null;
		importResult = null;

		try {
			const result = await importClientsFromKeez({}).updates(getClients());

			if (result.success) {
				importResult = { imported: result.imported, updated: (result as any).updated || 0, skipped: result.skipped };
				showSuccess(5000);
			}
		} catch (e) {
			importError = extractErrorMessage(e, 'Failed to import clients from Keez');
		} finally {
			importingClients = false;
		}
	}

	async function handleSaveHostingSeries() {
		savingHostingSeries = true;
		try {
			await updateInvoiceSettings({
				keezSeriesHosting: keezSeriesHosting.trim() ? keezSeriesHosting.trim() : null,
				keezStartNumberHosting: keezStartNumberHosting.trim()
					? keezStartNumberHosting.trim()
					: null
			}).updates(invoiceSettingsQuery);
			toast.success('Setări serie hosting salvate.');
		} catch (e) {
			toast.error(
				'A apărut o eroare: ' + extractErrorMessage(e, 'Nu s-au putut salva setările')
			);
		} finally {
			savingHostingSeries = false;
		}
	}

	async function handleSaveZeroVatSettings() {
		savingZeroVatSettings = true;
		try {
			await updateInvoiceSettings({
				whmcsZeroVatAutoDetect: zeroVatAutoDetect,
				whmcsZeroVatNoteIntracom: zeroVatNoteIntracom.trim()
					? zeroVatNoteIntracom.trim()
					: null,
				whmcsZeroVatNoteExport: zeroVatNoteExport.trim() ? zeroVatNoteExport.trim() : null,
				whmcsStrictBnrConversion: strictBnrConversion
			}).updates(invoiceSettingsQuery);
			toast.success('Setări TVA 0% / BNR salvate.');
		} catch (e) {
			toast.error(
				'A apărut o eroare: ' +
					extractErrorMessage(e, 'Nu s-au putut salva setările TVA 0%')
			);
		} finally {
			savingZeroVatSettings = false;
		}
	}

	async function handleSyncInvoices() {
		syncingInvoices = true;
		importError = null;
		importResult = null;

		try {
			const invoicesQuery = getInvoices({});
			const result = await syncInvoicesFromKeez({}).updates(invoicesQuery);

			if (result.success) {
				importResult = { imported: result.imported, skipped: result.skipped };
				await invoicesQuery.refresh();
				showSuccess(5000);
			}
		} catch (e) {
			importError = extractErrorMessage(e, 'Failed to sync invoices from Keez');
		} finally {
			syncingInvoices = false;
		}
	}
</script>

<p class="text-muted-foreground mb-6">
	Gestionează integrarea Keez. Conectează-ți contul pentru sincronizarea automată a facturilor sau importă clienți și facturi din Keez.
</p>

{#if loading}
	<Card>
		<CardContent class="p-6">
			<div class="animate-pulse space-y-4">
				<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
				<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
			</div>
		</CardContent>
	</Card>
{:else if credentialsCorrupt}
	<Card>
		<CardHeader>
			<div class="flex items-center gap-2">
				<CardTitle>Conexiune Keez</CardTitle>
				<Badge variant="destructive" class="gap-1">
					<AlertTriangle class="h-3 w-3" />
					Eroare credențiale
				</Badge>
			</div>
			<CardDescription>
				Credențialele Keez sunt corupte și trebuie re-salvate. Re-introduceți secretul mai jos.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 mb-6">
				<div class="flex items-start gap-3">
					<AlertTriangle class="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
					<div>
						<p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
							Credențialele Keez trebuie re-salvate
						</p>
						<p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
							Credențialele stocate nu au putut fi decriptate. Acest lucru se poate întâmpla după o modificare a configurației serverului.
							Re-introduceți secretul API Keez pentru a restabili conexiunea. Client EID și Application ID au fost pre-completate.
						</p>
					</div>
				</div>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleConnect();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="clientEid">Client EID</Label>
						<Input
							id="clientEid"
							type="text"
							bind:value={clientEid}
							placeholder="Enter your Client EID"
							required
						/>
					</div>

					<div class="space-y-2">
						<Label for="applicationId">Application ID</Label>
						<Input
							id="applicationId"
							type="text"
							bind:value={applicationId}
							placeholder="Enter your Application ID"
							required
						/>
					</div>

					<div class="space-y-2">
						<Label for="secret">Secret</Label>
						<Input
							id="secret"
							type="password"
							bind:value={secret}
							placeholder="Re-enter your Keez API secret"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Re-introduceți secretul API Keez pentru a restabili conexiunea
						</p>
					</div>
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
					</div>
				{/if}

				{#if success}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">Credențiale re-salvate cu succes!</p>
					</div>
				{/if}

				<div class="flex gap-2">
					<Button type="submit" disabled={connecting || !clientEid || !applicationId || !secret}>
						{connecting ? 'Se reconectează...' : 'Re-salvare credențiale'}
					</Button>
					<Button variant="outline" onclick={handleDisconnect} disabled={disconnecting}>
						{disconnecting ? 'Se deconectează...' : 'Deconectare'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
{:else if status?.connected && status?.isActive}
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<CardTitle>Conexiune Keez</CardTitle>
					{#if status.isDegraded}
						<Badge variant="outline" class="gap-1 border-amber-500 text-amber-700 dark:text-amber-400">
							<AlertTriangle class="h-3 w-3" />
							Degradat
						</Badge>
					{:else}
						<Badge variant="default" class="gap-1">
							<CheckCircle2 class="h-3 w-3" />
							Conectat
						</Badge>
					{/if}
				</div>
			</div>
			<CardDescription>
				{#if status.isDegraded}
					Ultima sincronizare a eșuat. Integrarea rămâne activă, dar datele din CRM pot fi neactualizate.
					{#if status.lastFailureReason}
						<span class="mt-1 block text-xs text-amber-700 dark:text-amber-400">
							Detalii: {status.lastFailureReason}
						</span>
					{/if}
				{:else}
					Contul Keez este conectat și activ
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			<div class="space-y-2">
				<Label>Client EID</Label>
				<Input type="text" value={status.clientEid || ''} disabled class="bg-muted" />
			</div>

			<div class="space-y-2">
				<Label>Application ID</Label>
				<Input type="text" value={status.applicationId || ''} disabled class="bg-muted" />
			</div>

			<div class="space-y-2">
				<Label>Ultima sincronizare</Label>
				<Input
					type="text"
					value={formatDate(status.lastSyncAt ?? null)}
					disabled
					class="bg-muted"
				/>
			</div>

			<Separator />

			<!-- Hosting series -->
			<div class="space-y-4">
				<div>
					<h3 class="text-lg font-semibold">Serie hosting Keez</h3>
					<p class="text-sm text-muted-foreground">
						Configurează o serie Keez dedicată pentru facturile recurente de hosting (cont
						DirectAdmin). Dacă lipsește, se folosește seria Keez default: <span class="font-mono font-medium">{invoiceSettings?.keezSeries ?? '(neconfigurată)'}</span>.
					</p>
				</div>

				<div class="space-y-2">
					<Label for="keez-series-hosting">Serie Keez pentru hosting (opțional)</Label>
					<Input
						id="keez-series-hosting"
						type="text"
						bind:value={keezSeriesHosting}
						placeholder="HOST"
					/>
				</div>

				<div class="space-y-2">
					<Label for="keez-start-number-hosting">Număr de start (opțional)</Label>
					<Input
						id="keez-start-number-hosting"
						type="text"
						bind:value={keezStartNumberHosting}
						placeholder="1"
					/>
					<p class="text-xs text-muted-foreground">
						Opțional — Keez gestionează numerotarea automat pentru serii noi. Folosit doar ca
						fallback când API-ul Keez nu răspunde.
					</p>
				</div>

				{#if invoiceSettings?.keezLastSyncedNumberHosting}
					<div class="space-y-2">
						<Label>Ultimul număr sincronizat (read-only)</Label>
						<Input
							type="text"
							value={invoiceSettings.keezLastSyncedNumberHosting}
							disabled
							class="bg-muted font-mono"
						/>
					</div>
				{/if}

				<div>
					<Button
						type="button"
						onclick={handleSaveHostingSeries}
						disabled={savingHostingSeries}
					>
						{savingHostingSeries ? 'Se salvează...' : 'Salvează serie hosting'}
					</Button>
				</div>
			</div>

			<Separator />

			<!-- Zero-VAT compliance + Strict BNR -->
			<div class="space-y-4">
				<div>
					<h3 class="text-lg font-semibold">Conformitate TVA 0% (intracomunitar &amp; export)</h3>
					<p class="text-sm text-muted-foreground">
						Pentru clienții din UE cu CUI valid (taxare inversă) sau din afara UE (export),
						sistemul detectează automat și forțează 0% TVA pe factură, adăugând textul legal
						cerut de ANAF. Se aplică la toate facturile generate pe pluginul Keez, inclusiv
						facturile recurente de hosting.
					</p>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-0.5">
						<Label for="zero-vat-auto-detect">Detectare automată TVA 0%</Label>
						<p class="text-xs text-muted-foreground">
							Activ: detectează intracom (UE non-RO) vs export (non-UE) după
							<code>country</code> / <code>CUI</code> al clientului și adaugă textul corespunzător
							plus forțează 0% TVA. Inactiv: nu se atinge nota facturii.
						</p>
					</div>
					<Switch id="zero-vat-auto-detect" bind:checked={zeroVatAutoDetect} />
				</div>

				<div class="space-y-1.5">
					<Label for="zero-vat-intracom">Notă intracomunitar (UE B2B cu CUI valid)</Label>
					<textarea
						id="zero-vat-intracom"
						bind:value={zeroVatNoteIntracom}
						placeholder="Ex.: Taxare inversă conform art. 278 alin. (2) Cod Fiscal — operațiune intracomunitară."
						rows={2}
						class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
						disabled={!zeroVatAutoDetect}
					></textarea>
					<p class="text-xs text-muted-foreground">
						Lăsat gol → folosește textul implicit cerut de ANAF.
					</p>
				</div>

				<div class="space-y-1.5">
					<Label for="zero-vat-export">Notă export (clienți non-UE)</Label>
					<textarea
						id="zero-vat-export"
						bind:value={zeroVatNoteExport}
						placeholder="Ex.: Operațiune neimpozabilă în România conform art. 278 alin. (1) Cod Fiscal — export."
						rows={2}
						class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
						disabled={!zeroVatAutoDetect}
					></textarea>
					<p class="text-xs text-muted-foreground">
						Lăsat gol → folosește textul implicit.
					</p>
				</div>

				<Separator />

				<div class="flex items-center justify-between gap-4">
					<div class="space-y-0.5">
						<Label for="strict-bnr">Strict BNR rate pentru facturi în valută</Label>
						<p class="text-xs text-muted-foreground">
							Activ: dacă cursul BNR pentru moneda facturii (EUR / USD / etc.) lipsește
							sau e mai vechi de 26h, generarea facturii recurente eșuează tranzient și
							se reîncearcă după următoarea sincronizare BNR (zilnic 10:00). Previne
							facturile cu sume × 5 când cursul lipsește. <strong>Recomandat ON.</strong>
						</p>
					</div>
					<Switch id="strict-bnr" bind:checked={strictBnrConversion} />
				</div>

				<div>
					<Button
						type="button"
						onclick={handleSaveZeroVatSettings}
						disabled={savingZeroVatSettings}
					>
						{savingZeroVatSettings ? 'Se salvează...' : 'Salvează setări TVA 0% / BNR'}
					</Button>
				</div>
			</div>

			<Separator />

			<div class="space-y-6">
				<div class="space-y-4">
					<h3 class="text-lg font-semibold">Import din Keez</h3>
					<p class="text-sm text-muted-foreground">
						Importă clienți și facturi direct din contul tău Keez.
					</p>

					<div class="space-y-4">
						<div class="space-y-2">
							<Label>Import clienți</Label>
							<div class="space-y-2">
								<Button
									type="button"
									variant="default"
									onclick={handleImportClients}
									disabled={importingClients || syncingInvoices}
								>
									<Download class="h-4 w-4 mr-2" />
									{importingClients ? 'Se importă...' : 'Import clienți din Keez'}
								</Button>
								<p class="text-xs text-muted-foreground">
									Importă toți clienții/partenerii din contul Keez
								</p>
							</div>
						</div>

						<div class="space-y-2">
							<Label>Sincronizare facturi</Label>
							<div class="space-y-2">
								<Button
									type="button"
									variant="default"
									onclick={handleSyncInvoices}
									disabled={importingClients || syncingInvoices}
								>
									<Download class="h-4 w-4 mr-2" />
									{syncingInvoices ? 'Se sincronizează...' : 'Sincronizare facturi din Keez'}
								</Button>
								<p class="text-xs text-muted-foreground">
									Importă facturile din contul Keez. Facturile existente vor fi ignorate.
								</p>
							</div>
						</div>
					</div>
				</div>

				<Separator />

				{#if syncHistory.length > 0}
					<div class="space-y-3">
						<h3 class="text-sm font-semibold">Istoric sincronizare (ultimele 20)</h3>
						<div class="rounded-md border overflow-hidden">
							<table class="w-full text-xs">
								<thead class="bg-muted">
									<tr>
										<th class="text-left p-2 font-medium">Factură</th>
										<th class="text-left p-2 font-medium">Direcție</th>
										<th class="text-left p-2 font-medium">Status</th>
										<th class="text-left p-2 font-medium">Ultima sincronizare</th>
									</tr>
								</thead>
								<tbody>
									{#each syncHistory as record (record.id ?? record.invoiceId)}
										<tr class="border-t">
											<td class="p-2">{record.invoiceNumber || record.invoiceId}</td>
											<td class="p-2">
												{#if record.syncDirection === 'push'}↑ Push{:else if record.syncDirection === 'pull'}↓ Pull{:else}↕ Both{/if}
											</td>
											<td class="p-2">
												{#if record.syncStatus === 'synced'}
													<span class="text-green-600 dark:text-green-400">✓ Synced</span>
												{:else if record.syncStatus === 'error'}
													<span class="text-red-600 dark:text-red-400" title={record.errorMessage || ''}>✗ Error</span>
												{:else}
													<span class="text-yellow-600">⏳ Pending</span>
												{/if}
											</td>
											<td class="p-2 text-muted-foreground">
												{record.lastSyncedAt ? new Date(record.lastSyncedAt).toLocaleString() : '—'}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>

					<Separator />
				{/if}

				<div class="flex gap-2">
					<Button variant="outline" onclick={handleDisconnect} disabled={disconnecting}>
						{disconnecting ? 'Se deconectează...' : 'Deconectare'}
					</Button>
					<Button variant="outline" href="/{tenantSlug}/settings/invoices">
						<LinkIcon class="h-4 w-4 mr-2" />
						Invoice Settings
					</Button>
				</div>
			</div>

			{#if error || importError}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-200">{error || importError}</p>
				</div>
			{/if}

			{#if success && importResult}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">
						Successfully imported {importResult.imported} item{importResult.imported === 1 ? '' : 's'}{importResult.updated && importResult.updated > 0 ? `, ${importResult.updated} updated` : ''}{importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ''}!
					</p>
				</div>
			{:else if success}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">Deconectat cu succes!</p>
				</div>
			{/if}
		</CardContent>
	</Card>
{:else}
	<Card>
		<CardHeader>
			<div class="flex items-center gap-2">
				<CardTitle>Conectare Keez</CardTitle>
				<Badge variant="outline" class="gap-1">
					<XCircle class="h-3 w-3" />
					Neconectat
				</Badge>
			</div>
			<CardDescription>
				Introduceți credențialele API Keez pentru a vă conecta contul. Le puteți găsi în setările contului Keez.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleConnect();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="new-clientEid">Client EID</Label>
						<Input
							id="new-clientEid"
							type="text"
							bind:value={clientEid}
							placeholder="Enter your Client EID"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Identificatorul unic al companiei tale în Keez
						</p>
					</div>

					<div class="space-y-2">
						<Label for="new-applicationId">Application ID</Label>
						<Input
							id="new-applicationId"
							type="text"
							bind:value={applicationId}
							placeholder="Enter your Application ID"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Identificatorul aplicației tale în Keez
						</p>
					</div>

					<div class="space-y-2">
						<Label for="new-secret">Secret</Label>
						<Input
							id="new-secret"
							type="password"
							bind:value={secret}
							placeholder="Enter your Keez API secret"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Secretul API Keez (parola) furnizat de Keez
						</p>
					</div>
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
					</div>
				{/if}

				{#if success}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">Conectat cu succes!</p>
					</div>
				{/if}

				<Button type="submit" disabled={connecting || !clientEid || !applicationId || !secret}>
					{connecting ? 'Se conectează...' : 'Conectare Keez'}
				</Button>
			</form>
		</CardContent>
	</Card>
{/if}
