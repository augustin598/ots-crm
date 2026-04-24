<script lang="ts">
	import {
		getWhmcsStatus,
		getWhmcsRecentSyncs,
		getWhmcsMatchStats,
		getWhmcsDeadLetters,
		setupOrRotateWhmcsIntegration,
		regenerateWhmcsSecret,
		setWhmcsActive,
		setEnableKeezPush,
		saveWhmcsHostingSeries,
		replayWhmcsSync,
		testWhmcsConnection
	} from '$lib/remotes/whmcs.remote';
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
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import {
		AlertTriangle,
		CheckCircle2,
		Copy,
		RotateCw,
		Play,
		ShieldAlert
	} from '@lucide/svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { toast } from 'svelte-sonner';
	import { extractErrorMessage } from '$lib/utils';

	// ─────────────────────────────────────────────
	// Queries
	// ─────────────────────────────────────────────
	const statusQuery = getWhmcsStatus();
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	const syncsQuery = getWhmcsRecentSyncs();
	const syncs = $derived(syncsQuery.current ?? []);

	const matchStatsQuery = getWhmcsMatchStats();
	const matchStats = $derived(
		matchStatsQuery.current ?? { WHMCS_ID: 0, CUI: 0, EMAIL: 0, NEW: 0, unknown: 0 }
	);

	const deadLettersQuery = getWhmcsDeadLetters();
	const deadLetters = $derived(deadLettersQuery.current ?? []);

	// ─────────────────────────────────────────────
	// Local state
	// ─────────────────────────────────────────────
	let whmcsUrl = $state('');
	let submittingSetup = $state(false);
	let regenerating = $state(false);
	let regenerateDialogOpen = $state(false);
	let showSecretDialogOpen = $state(false);
	let shownSecret = $state<string | null>(null);

	let testing = $state(false);
	let testResult = $state<Awaited<ReturnType<typeof testWhmcsConnection>> | null>(null);

	let togglingActive = $state(false);
	let togglingKeezPush = $state(false);

	// Hosting series form state.
	// NOTE: form fields must be $state (not $derived) because the user must be
	// able to edit them. We initialize once from server settings via an $effect
	// guarded by formInitialized so a status refresh mid-edit does not clobber
	// the user's in-progress input. Same pattern as the Keez settings page.
	let keezSeriesHosting = $state('');
	let keezStartNumberHosting = $state('');
	let whmcsAutoPushToKeez = $state(false);
	let formInitialized = $state(false);
	let savingHostingSeries = $state(false);

	let replayingId = $state<string | null>(null);

	$effect(() => {
		if (!formInitialized && status?.settings) {
			keezSeriesHosting = status.settings.keezSeriesHosting ?? '';
			keezStartNumberHosting = status.settings.keezStartNumberHosting ?? '';
			whmcsAutoPushToKeez = status.settings.whmcsAutoPushToKeez ?? false;
			formInitialized = true;
		}
	});

	// ─────────────────────────────────────────────
	// Derived presentation
	// ─────────────────────────────────────────────
	const webhookUrl = $derived.by(() => {
		if (!status) return '';
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		return `${origin}${status.webhookBase}/invoices`;
	});

	// ─────────────────────────────────────────────
	// Format helpers
	// ─────────────────────────────────────────────
	function formatDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		try {
			return new Date(d).toLocaleString('ro-RO');
		} catch {
			return String(d);
		}
	}

	function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
		if (amount === null || amount === undefined) return '—';
		const cur = currency ?? '';
		return `${amount.toFixed(2)} ${cur}`.trim();
	}

	function stateBadgeVariant(state: string | null | undefined) {
		switch (state) {
			case 'KEEZ_PUSHED':
				return 'default' as const;
			case 'INVOICE_CREATED':
				return 'success' as const;
			case 'DEAD_LETTER':
				return 'destructive' as const;
			case 'FAILED':
				return 'warning' as const;
			case 'PENDING':
			default:
				return 'secondary' as const;
		}
	}

	// ─────────────────────────────────────────────
	// Actions
	// ─────────────────────────────────────────────
	async function copyToClipboard(text: string, successMessage = 'Copiat în clipboard') {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(successMessage);
		} catch {
			toast.error('Nu s-a putut copia. Selectează manual textul.');
		}
	}

	async function handleSetup() {
		const trimmed = whmcsUrl.trim();
		if (!trimmed) {
			toast.error('Introdu URL-ul WHMCS.');
			return;
		}
		submittingSetup = true;
		try {
			const result = await setupOrRotateWhmcsIntegration({ whmcsUrl: trimmed }).updates(statusQuery);
			shownSecret = result.plainSecret;
			showSecretDialogOpen = true;
			whmcsUrl = '';
			toast.success('Integrare WHMCS configurată. Copiază secretul acum.');
		} catch (e) {
			toast.error('A apărut o eroare: ' + extractErrorMessage(e, 'Nu s-a putut configura integrarea'));
		} finally {
			submittingSetup = false;
		}
	}

	async function handleRegenerateSecret() {
		regenerating = true;
		try {
			const result = await regenerateWhmcsSecret().updates(statusQuery);
			shownSecret = result.plainSecret;
			regenerateDialogOpen = false;
			showSecretDialogOpen = true;
			toast.success('Secret regenerat. Copiază-l acum.');
		} catch (e) {
			toast.error('A apărut o eroare: ' + extractErrorMessage(e, 'Nu s-a putut regenera secretul'));
		} finally {
			regenerating = false;
		}
	}

	async function handleTestConnection() {
		testing = true;
		testResult = null;
		try {
			const result = await testWhmcsConnection();
			testResult = result;
			if (result.ok) {
				toast.success('Conexiune OK — webhook-ul e accesibil și semnătura e validă');
			} else {
				toast.error(`Test eșuat la pasul ${result.step}: ${result.reason}`);
			}
		} catch (err) {
			toast.error('A apărut o eroare: ' + (err instanceof Error ? err.message : String(err)));
		} finally {
			testing = false;
		}
	}

	async function handleToggleActive(newValue: boolean) {
		togglingActive = true;
		try {
			await setWhmcsActive({ isActive: newValue }).updates(statusQuery);
			toast.success(newValue ? 'Integrare activată' : 'Integrare dezactivată');
		} catch (e) {
			toast.error('A apărut o eroare: ' + extractErrorMessage(e, 'Nu s-a putut modifica starea'));
		} finally {
			togglingActive = false;
		}
	}

	async function handleToggleKeezPush(newValue: boolean) {
		togglingKeezPush = true;
		try {
			await setEnableKeezPush({ enabled: newValue }).updates(statusQuery);
			toast.success(newValue ? 'Push la Keez activat' : 'Push la Keez dezactivat (dry-run)');
		} catch (e) {
			toast.error('A apărut o eroare: ' + extractErrorMessage(e, 'Nu s-a putut modifica setarea'));
		} finally {
			togglingKeezPush = false;
		}
	}

	async function handleSaveHostingSeries() {
		savingHostingSeries = true;
		try {
			await saveWhmcsHostingSeries({
				keezSeriesHosting: keezSeriesHosting.trim() ? keezSeriesHosting.trim() : null,
				keezStartNumberHosting: keezStartNumberHosting.trim() ? keezStartNumberHosting.trim() : null,
				whmcsAutoPushToKeez
			}).updates(statusQuery);
			toast.success('Setări salvate.');
		} catch (e) {
			toast.error('A apărut o eroare: ' + extractErrorMessage(e, 'Nu s-au putut salva setările'));
		} finally {
			savingHostingSeries = false;
		}
	}

	async function handleReplay(syncId: string) {
		replayingId = syncId;
		try {
			await replayWhmcsSync({ syncId }).updates(syncsQuery, deadLettersQuery);
			toast.success('Sincronizare replay-uită. Se va reprocesa.');
		} catch (e) {
			toast.error('A apărut o eroare: ' + extractErrorMessage(e, 'Replay eșuat'));
		} finally {
			replayingId = null;
		}
	}

	function closeSecretDialog() {
		showSecretDialogOpen = false;
		shownSecret = null;
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Integrare WHMCS</h1>
		<p class="text-muted-foreground mt-1">
			Sincronizează facturile hosting din WHMCS către CRM (care le trimite mai departe la Keez).
		</p>
	</div>

	{#if loading}
		<Card>
			<CardContent class="p-6">
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			</CardContent>
		</Card>
	{:else}
		<!-- Section 1: Status + credentials -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2 flex-wrap">
					<CardTitle>Status conexiune</CardTitle>
					{#if status?.connected}
						{#if status.integration?.isActive}
							<Badge variant="success" class="gap-1">
								<CheckCircle2 class="h-3 w-3" />
								Activ
							</Badge>
						{:else}
							<Badge variant="secondary" class="gap-1">Inactiv</Badge>
						{/if}
						{#if status.integration?.enableKeezPush}
							<Badge variant="default">Live</Badge>
						{:else}
							<Badge variant="warning">Dry-run</Badge>
						{/if}
					{:else}
						<Badge variant="outline">Neconfigurat</Badge>
					{/if}
				</div>
				<CardDescription>
					{#if status?.connected}
						Integrarea este configurată. Copiază webhook URL-ul în modulul WHMCS.
					{:else}
						Introdu URL-ul instanței tale WHMCS pentru a genera un secret partajat.
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-6">
				{#if status?.connected && status.integration}
					{#if status.circuitBreakerOpen}
						<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
							<div class="flex items-start gap-3">
								<ShieldAlert class="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
								<div class="space-y-1">
									<p class="text-sm font-medium text-red-800 dark:text-red-200">
										Circuit breaker deschis până la {formatDate(status.circuitBreakerUntil)}
									</p>
									<p class="text-sm text-red-700 dark:text-red-300">
										Webhookurile sunt respinse până atunci. Eșecuri consecutive: {status.integration.consecutiveFailures}
									</p>
								</div>
							</div>
						</div>
					{/if}

					<div class="space-y-2">
						<Label>URL WHMCS</Label>
						<Input type="text" value={status.integration.whmcsUrl} disabled class="bg-muted" />
					</div>

					<div class="space-y-2">
						<Label>Webhook URL</Label>
						<div class="flex gap-2">
							<Input type="text" value={webhookUrl} disabled class="bg-muted font-mono text-xs" />
							<Button type="button" variant="outline" onclick={() => copyToClipboard(webhookUrl, 'Webhook URL copiat')}>
								<Copy class="h-4 w-4" />
							</Button>
						</div>
						<p class="text-xs text-muted-foreground">
							Configurează această adresă în modulul WHMCS pentru recepția facturilor.
						</p>
					</div>

					<Separator />

					<div class="space-y-4">
						<div class="flex items-center justify-between gap-4">
							<div class="space-y-0.5">
								<Label for="whmcs-active">Integrare activă</Label>
								<p class="text-xs text-muted-foreground">
									Dezactivată: webhookurile WHMCS sunt respinse imediat.
								</p>
							</div>
							<Switch
								id="whmcs-active"
								checked={status.integration.isActive}
								disabled={togglingActive}
								onCheckedChange={(v) => handleToggleActive(v)}
							/>
						</div>

						<div class="flex items-center justify-between gap-4">
							<div class="space-y-0.5">
								<Label for="whmcs-keez-push">Push automat la Keez</Label>
								<p class="text-xs text-muted-foreground">
									Dezactivat = dry-run: facturile se creează în CRM dar nu se împing la Keez.
								</p>
							</div>
							<Switch
								id="whmcs-keez-push"
								checked={status.integration.enableKeezPush}
								disabled={togglingKeezPush}
								onCheckedChange={(v) => handleToggleKeezPush(v)}
							/>
						</div>
					</div>

					<Separator />

					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
						<div>
							<Label class="text-xs text-muted-foreground">Ultima sincronizare reușită</Label>
							<p class="mt-1">{formatDate(status.integration.lastSuccessfulSyncAt)}</p>
						</div>
						<div>
							<Label class="text-xs text-muted-foreground">Eșecuri consecutive</Label>
							<p class="mt-1">{status.integration.consecutiveFailures}</p>
						</div>
						{#if status.integration.lastFailureReason}
							<div class="md:col-span-2">
								<Label class="text-xs text-muted-foreground">Ultimul motiv de eșec</Label>
								<p class="mt-1 text-amber-700 dark:text-amber-400 text-xs">
									{status.integration.lastFailureReason}
								</p>
							</div>
						{/if}
					</div>

					<Separator />

					<div class="space-y-3">
						<Button
							type="button"
							variant="secondary"
							disabled={testing}
							onclick={handleTestConnection}
						>
							<CircleCheck class="h-4 w-4 mr-2" />
							{testing ? 'Se testează...' : 'Testează conexiunea'}
						</Button>
						<p class="text-xs text-muted-foreground">
							Verifică end-to-end: integrare activă, decriptare secret, HMAC și round-trip HTTP la webhook.
						</p>

						{#if testResult?.ok === true}
							<div
								class="p-3 rounded-md border text-sm bg-green-50 border-green-300 text-green-900 dark:bg-green-950/40 dark:border-green-800 dark:text-green-100"
							>
								<p class="font-bold">✓ Conexiune validă</p>
								<ul class="mt-2 space-y-0.5 text-xs">
									<li>
										<span class="font-medium">Connector version:</span>
										<span class="font-mono">{testResult.connectorVersion}</span>
									</li>
									<li>
										<span class="font-medium">Mod:</span>
										{testResult.dryRun ? 'Dry-run' : 'Live'}
									</li>
									<li>
										<span class="font-medium">Round-trip:</span>
										{testResult.roundTripMs} ms
									</li>
									<li class="break-all">
										<span class="font-medium">URL:</span>
										<span class="font-mono">{testResult.url}</span>
									</li>
								</ul>
							</div>
						{:else if testResult && testResult.ok === false}
							<div
								class="p-3 rounded-md border text-sm bg-red-50 border-red-300 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-100"
							>
								<p class="font-bold">✗ Test eșuat la pasul: {testResult.step}</p>
								<p class="mt-1">Motiv: {testResult.reason}</p>
								{#if testResult.detail}
									<p class="mt-1 text-xs font-mono break-all">Detalii: {testResult.detail}</p>
								{/if}
								{#if testResult.url}
									<p class="mt-1 text-xs break-all">
										<span class="font-medium">URL:</span>
										<span class="font-mono">{testResult.url}</span>
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<div>
						<Button
							type="button"
							variant="destructive"
							onclick={() => (regenerateDialogOpen = true)}
							disabled={regenerating}
						>
							<RotateCw class="h-4 w-4 mr-2" />
							Regenerează secret
						</Button>
						<p class="text-xs text-muted-foreground mt-2">
							Invalidează secretul curent. Va trebui să reconfigurezi modulul WHMCS.
						</p>
					</div>
				{:else}
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleSetup();
						}}
						class="space-y-4"
					>
						<div class="space-y-2">
							<Label for="whmcs-url">URL WHMCS</Label>
							<Input
								id="whmcs-url"
								type="url"
								bind:value={whmcsUrl}
								placeholder="https://billing.exemplu.ro"
								required
							/>
							<p class="text-xs text-muted-foreground">
								URL-ul de bază al instanței tale WHMCS (fără slash final).
							</p>
						</div>
						<Button type="submit" disabled={submittingSetup || !whmcsUrl.trim()}>
							{submittingSetup ? 'Se configurează...' : 'Configurează WHMCS'}
						</Button>
					</form>
				{/if}
			</CardContent>
		</Card>

		{#if status?.connected}
			<!-- Section 2: Hosting series -->
			<Card>
				<CardHeader>
					<CardTitle>Serie hosting Keez</CardTitle>
					<CardDescription>
						Configurează o serie Keez dedicată pentru facturile venite din WHMCS. Dacă lipsește, se folosește seria Keez default: <span class="font-mono font-medium">{status.settings?.keezSeries ?? '(neconfigurată)'}</span>.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
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
							Opțional — Keez gestionează numerotarea automat pentru serii noi.
						</p>
					</div>

					<div class="flex items-center justify-between gap-4">
						<div class="space-y-0.5">
							<Label for="whmcs-auto-push-keez">Push automat la Keez după recepția facturii</Label>
							<p class="text-xs text-muted-foreground">
								Necesită și switch-ul "Push automat la Keez" activ pe integrare.
							</p>
						</div>
						<Switch id="whmcs-auto-push-keez" bind:checked={whmcsAutoPushToKeez} />
					</div>

					<div>
						<Button type="button" onclick={handleSaveHostingSeries} disabled={savingHostingSeries}>
							{savingHostingSeries ? 'Se salvează...' : 'Salvează'}
						</Button>
					</div>
				</CardContent>
			</Card>

			<!-- Section 3: Match stats -->
			<Card>
				<CardHeader>
					<CardTitle>Statistici matching (ultimele 24h)</CardTitle>
					<CardDescription>
						Cum au fost asociate facturile WHMCS cu clienții din CRM.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="grid grid-cols-2 md:grid-cols-5 gap-4">
						<div class="rounded-md border p-4 text-center">
							<p class="text-2xl font-bold">{matchStats.WHMCS_ID}</p>
							<p class="text-xs text-muted-foreground mt-1">Match după ID WHMCS</p>
						</div>
						<div class="rounded-md border p-4 text-center">
							<p class="text-2xl font-bold">{matchStats.CUI}</p>
							<p class="text-xs text-muted-foreground mt-1">Match după CUI</p>
						</div>
						<div class="rounded-md border p-4 text-center">
							<p class="text-2xl font-bold">{matchStats.EMAIL}</p>
							<p class="text-xs text-muted-foreground mt-1">Match după email</p>
						</div>
						<div class="rounded-md border p-4 text-center">
							<div class="flex items-center justify-center gap-1">
								<p class="text-2xl font-bold">{matchStats.NEW}</p>
								{#if matchStats.NEW > 10}
									<span
										title="Multe creații noi — verifică mapping-ul CUI/email în WHMCS"
										class="text-amber-600 dark:text-amber-400"
									>
										<AlertTriangle class="h-4 w-4" />
									</span>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground mt-1">Clienți noi</p>
						</div>
						<div class="rounded-md border p-4 text-center">
							<p class="text-2xl font-bold">{matchStats.unknown}</p>
							<p class="text-xs text-muted-foreground mt-1">Necunoscut</p>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Section 4: Event log -->
			<Card>
				<CardHeader>
					<CardTitle>Jurnal evenimente</CardTitle>
					<CardDescription>Ultimele 50 de facturi WHMCS recepționate.</CardDescription>
				</CardHeader>
				<CardContent>
					{#if syncs.length === 0}
						<p class="text-sm text-muted-foreground py-8 text-center">
							Încă nu au venit evenimente WHMCS.
						</p>
					{:else}
						<div class="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Data</TableHead>
										<TableHead>ID factură WHMCS</TableHead>
										<TableHead>Stare</TableHead>
										<TableHead>Eveniment</TableHead>
										<TableHead>Match</TableHead>
										<TableHead>Sumă</TableHead>
										<TableHead>Eroare</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{#each syncs as sync (sync.id)}
										<TableRow>
											<TableCell class="text-xs whitespace-nowrap">
												{formatDate(sync.receivedAt)}
											</TableCell>
											<TableCell class="font-mono text-xs">{sync.whmcsInvoiceId}</TableCell>
											<TableCell>
												<Badge variant={stateBadgeVariant(sync.state)}>{sync.state ?? '—'}</Badge>
											</TableCell>
											<TableCell class="text-xs">{sync.lastEvent ?? '—'}</TableCell>
											<TableCell class="text-xs">{sync.matchType ?? '—'}</TableCell>
											<TableCell class="text-xs whitespace-nowrap">
												{formatAmount(sync.originalAmount, sync.originalCurrency)}
											</TableCell>
											<TableCell class="text-xs text-red-600 dark:text-red-400 max-w-xs truncate">
												{#if sync.lastErrorMessage}
													<span title={sync.lastErrorMessage}>
														{sync.lastErrorClass ? `[${sync.lastErrorClass}] ` : ''}{sync.lastErrorMessage}
													</span>
												{:else}
													—
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

			<!-- Section 5: Dead letter queue -->
			{#if deadLetters.length > 0}
				<Card>
					<CardHeader>
						<div class="flex items-center gap-2">
							<CardTitle>Probleme care necesită atenție</CardTitle>
							<Badge variant="destructive" class="gap-1">
								<AlertTriangle class="h-3 w-3" />
								{deadLetters.length}
							</Badge>
						</div>
						<CardDescription>
							Facturi blocate în stare DEAD_LETTER sau FAILED. Replay după ce ai rezolvat cauza erorii.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Data</TableHead>
										<TableHead>ID WHMCS</TableHead>
										<TableHead>Stare</TableHead>
										<TableHead>Eveniment</TableHead>
										<TableHead>Tip eroare</TableHead>
										<TableHead>Mesaj</TableHead>
										<TableHead class="text-right">Acțiuni</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{#each deadLetters as dl (dl.id)}
										<TableRow>
											<TableCell class="text-xs whitespace-nowrap">
												{formatDate(dl.receivedAt)}
											</TableCell>
											<TableCell class="font-mono text-xs">{dl.whmcsInvoiceId}</TableCell>
											<TableCell>
												<Badge variant={stateBadgeVariant(dl.state)}>{dl.state ?? '—'}</Badge>
											</TableCell>
											<TableCell class="text-xs">{dl.lastEvent ?? '—'}</TableCell>
											<TableCell class="text-xs">{dl.lastErrorClass ?? '—'}</TableCell>
											<TableCell class="text-xs text-red-600 dark:text-red-400 max-w-xs">
												<span title={dl.lastErrorMessage ?? ''}>
													{dl.lastErrorMessage ?? '—'}
												</span>
											</TableCell>
											<TableCell class="text-right">
												<Button
													type="button"
													size="sm"
													variant="outline"
													onclick={() => handleReplay(dl.id)}
													disabled={replayingId === dl.id}
												>
													<Play class="h-3 w-3 mr-1" />
													{replayingId === dl.id ? 'Replay...' : 'Replay'}
												</Button>
											</TableCell>
										</TableRow>
									{/each}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>
			{/if}
		{/if}
	{/if}
</div>

<!-- Dialog: show freshly generated secret -->
<Dialog bind:open={showSecretDialogOpen} onOpenChange={(o) => { if (!o) closeSecretDialog(); }}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Secret partajat WHMCS</DialogTitle>
			<DialogDescription>
				Copiază acest secret ACUM — nu va mai fi afișat. Îl vei folosi la configurarea modulului WHMCS.
			</DialogDescription>
		</DialogHeader>

		{#if shownSecret}
			<div class="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4">
				<div class="flex items-start gap-3">
					<AlertTriangle class="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
					<div class="flex-1 min-w-0 space-y-3">
						<p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
							Acest secret este afișat o singură dată.
						</p>
						<div class="rounded bg-white dark:bg-gray-900 p-3 font-mono text-xs break-all border border-yellow-200 dark:border-yellow-800">
							{shownSecret}
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => copyToClipboard(shownSecret ?? '', 'Secret copiat în clipboard')}
						>
							<Copy class="h-4 w-4 mr-2" />
							Copiază secret
						</Button>
					</div>
				</div>
			</div>
		{/if}

		<DialogFooter>
			<Button type="button" onclick={closeSecretDialog}>Am copiat, închide</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Dialog: confirm regenerate -->
<Dialog bind:open={regenerateDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Regenerează secret WHMCS?</DialogTitle>
			<DialogDescription>
				Secretul curent va fi invalidat imediat. Webhookurile din WHMCS vor fi respinse până când reconfigurezi modulul cu noul secret.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button type="button" variant="outline" onclick={() => (regenerateDialogOpen = false)} disabled={regenerating}>
				Anulează
			</Button>
			<Button type="button" variant="destructive" onclick={handleRegenerateSecret} disabled={regenerating}>
				{regenerating ? 'Se regenerează...' : 'Confirm regenerare'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
