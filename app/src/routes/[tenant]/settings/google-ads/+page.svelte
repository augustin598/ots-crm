<script lang="ts">
	import {
		getGoogleAdsConnectionStatus,
		getGoogleAdsAccounts,
		getClientsForMapping,
		saveGoogleAdsConfig,
		fetchGoogleAdsAccounts,
		assignGoogleAdsAccountToClient,
		triggerGoogleAdsSync,
		setGoogleAdsCookies,
		clearGoogleAdsCookies
	} from '$lib/remotes/google-ads-invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { CheckCircle2, XCircle, Link as LinkIcon, Unlink, Save, RefreshCw, Download, Trash2, Cookie, BarChart3 } from '@lucide/svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getGoogleAdsConnectionStatus();
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	const accountsQuery = getGoogleAdsAccounts();
	const accounts = $derived(accountsQuery.current || []);

	const clientsQuery = getClientsForMapping();
	const clients = $derived(clientsQuery.current || []);
	const clientOptions = $derived(
		clients.map((c) => ({ value: c.id, label: c.name }))
	);

	let mccAccountId = $state('');
	let developerToken = $state('');
	let syncEnabled = $state(true);
	let savingConfig = $state(false);
	let syncing = $state(false);
	let disconnecting = $state(false);
	let fetchingAccounts = $state(false);

	// Collapsible states
	let connectionOpen = $state(true);
	let cookiesOpen = $state(true);
	let accountsOpen = $state(true);
	let accountSearch = $state('');
	const filteredAccounts = $derived(
		accountSearch.trim()
			? accounts.filter((a: any) =>
				a.accountName.toLowerCase().includes(accountSearch.trim().toLowerCase()) ||
				a.googleAdsCustomerId.includes(accountSearch.trim().replace(/-/g, ''))
			)
			: accounts
	);

	// Cookie management
	let cookieJsonInput = $state('');
	let savingCookies = $state(false);

	// Initialize from status
	$effect(() => {
		if (status) {
			mccAccountId = status.mccAccountId || '';
			developerToken = status.developerToken || '';
			syncEnabled = status.syncEnabled ?? true;
		}
	});

	// URL params from OAuth callback
	const urlSuccess = $derived(page.url.searchParams.get('success') === 'true');
	const urlError = $derived(page.url.searchParams.get('error'));

	async function handleSaveConfig() {
		if (!mccAccountId || !developerToken) {
			toast.error('Completează MCC Account ID și Developer Token');
			return;
		}
		savingConfig = true;
		try {
			await saveGoogleAdsConfig({
				mccAccountId,
				developerToken,
				syncEnabled
			}).updates(statusQuery);
			toast.success('Configurare salvată');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			savingConfig = false;
		}
	}

	async function handleConnect() {
		if (!mccAccountId || !developerToken) {
			toast.error('Completează MCC Account ID și Developer Token înainte de conectare');
			return;
		}
		await handleSaveConfig();
		window.location.href = `/api/google-ads/auth?tenant=${tenantSlug}`;
	}

	async function handleDisconnect() {
		if (!confirm('Ești sigur că vrei să deconectezi Google Ads? Sincronizarea automată va fi oprită.')) {
			return;
		}

		disconnecting = true;
		try {
			const res = await fetch(`/api/google-ads/disconnect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tenant: tenantSlug })
			});
			if (!res.ok) throw new Error('Failed to disconnect');
			window.location.reload();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la deconectare');
		} finally {
			disconnecting = false;
		}
	}

	async function handleFetchAccounts() {
		fetchingAccounts = true;
		try {
			const result = await fetchGoogleAdsAccounts().updates(accountsQuery);
			toast.success(`${result.fetched} conturi Google Ads găsite`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la extragere conturi');
		} finally {
			fetchingAccounts = false;
		}
	}

	async function handleAssignClient(accountId: string, clientId: string) {
		try {
			await assignGoogleAdsAccountToClient({
				accountId,
				clientId: clientId || null
			}).updates(accountsQuery);
			toast.success('Client atribuit');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la atribuire');
		}
	}

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerGoogleAdsSync().updates(statusQuery);
			toast.success(`Sync complet: ${result.imported} importate, ${result.skipped} existente, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sincronizare');
		} finally {
			syncing = false;
		}
	}

	async function handleSaveCookies() {
		const json = cookieJsonInput.trim();
		if (!json) {
			toast.error('Inserează JSON-ul cookies din Cookie-Editor');
			return;
		}
		savingCookies = true;
		try {
			await setGoogleAdsCookies({ cookiesJson: json }).updates(statusQuery);
			toast.success('Cookies Google salvate');
			cookieJsonInput = '';
		} catch (e: any) {
			const msg = e?.body?.message || e?.message || 'Eroare la salvare cookies';
			toast.error(msg);
		} finally {
			savingCookies = false;
		}
	}

	async function handleClearCookies() {
		if (!confirm('Ștergi sesiunea Google? Download-ul facturilor via cookies nu va mai funcționa.')) return;
		try {
			await clearGoogleAdsCookies().updates(statusQuery);
			toast.success('Sesiune Google ștearsă');
		} catch (e: any) {
			toast.error(e?.body?.message || (e instanceof Error ? e.message : 'Eroare la ștergere sesiune'));
		}
	}

	function formatCustomerIdDisplay(id: string): string {
		const clean = id.replace(/-/g, '');
		if (clean.length !== 10) return id;
		return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleString('ro-RO');
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Google Ads</h1>
			<p class="text-muted-foreground">Configurare integrare Google Ads pentru descărcare automată facturi</p>
		</div>
		{#if status?.connected}
			<div class="flex flex-col items-end gap-1">
				<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
					{#if syncing}
						<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
						Sincronizare...
					{:else}
						<RefreshCw class="mr-2 h-4 w-4" />
						Sync Facturi
					{/if}
				</Button>
				{#if status.lastSyncAt}
					<p class="text-xs text-muted-foreground">
						Sync: {formatDate(status.lastSyncAt)}
						{#if status.lastSyncResults}
							— {status.lastSyncResults.imported ?? 0} importate, {status.lastSyncResults.errors ?? 0} erori
							{#if status.lastSyncResults.spendingInserted != null}
								| spend: {status.lastSyncResults.spendingInserted} noi, {status.lastSyncResults.spendingUpdated ?? 0} actualizate
							{/if}
						{/if}
					</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if urlSuccess}
		<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
			<p class="text-sm text-green-800 dark:text-green-200">Conectare Google Ads reușită!</p>
		</div>
	{/if}

	{#if urlError}
		<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
			<p class="text-sm text-red-800 dark:text-red-200">Eroare: {urlError}</p>
		</div>
	{/if}

	{#if loading}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else}
		<!-- Connection Card -->
		<Collapsible bind:open={connectionOpen}>
			<Card>
				<CollapsibleTrigger class="w-full text-left cursor-pointer">
					<CardHeader>
						<div class="flex items-center justify-between">
							<div>
								<CardTitle class="flex items-center gap-2">
									{#if status?.connected}
										<CheckCircle2 class="h-5 w-5 text-green-500" />
										Conectat
									{:else}
										<XCircle class="h-5 w-5 text-red-500" />
										Neconectat
									{/if}
								</CardTitle>
								<CardDescription>
									{#if status?.connected}
										Conectat cu {status.email}
									{:else}
										Conectează-te cu Google pentru a sincroniza facturile Google Ads
									{/if}
								</CardDescription>
							</div>
							<ChevronDownIcon class="h-5 w-5 text-muted-foreground transition-transform duration-200 {connectionOpen ? 'rotate-180' : ''}" />
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent class="space-y-4">
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-2">
								<Label for="mcc-id">MCC Account ID</Label>
								<Input
									id="mcc-id"
									type="text"
									placeholder="123-456-7890"
									bind:value={mccAccountId}
								/>
								<p class="text-xs text-muted-foreground">ID-ul contului Manager (MCC)</p>
							</div>
							<div class="space-y-2">
								<Label for="dev-token">Developer Token</Label>
								<Input
									id="dev-token"
									type="password"
									placeholder="Developer Token"
									bind:value={developerToken}
								/>
								<p class="text-xs text-muted-foreground">Token-ul de dezvoltator Google Ads API</p>
							</div>
						</div>

						<div class="flex items-center gap-2">
							<Switch bind:checked={syncEnabled} id="sync-enabled" />
							<Label for="sync-enabled">Sincronizare automată activă</Label>
						</div>

						<Separator />

						<div class="flex items-center gap-2 flex-wrap">
							{#if status?.connected}
								<Button variant="outline" onclick={handleSaveConfig} disabled={savingConfig}>
									{#if savingConfig}
										<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
									{:else}
										<Save class="mr-2 h-4 w-4" />
									{/if}
									Salvează Configurare
								</Button>
								<Button variant="outline" onclick={handleFetchAccounts} disabled={fetchingAccounts}>
									{#if fetchingAccounts}
										<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
										Extragere...
									{:else}
										<Download class="mr-2 h-4 w-4" />
										Extrage Conturi Google Ads
									{/if}
								</Button>
								<Button variant="outline" onclick={handleSync} disabled={syncing}>
									{#if syncing}
										<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
										Sincronizare...
									{:else}
										<RefreshCw class="mr-2 h-4 w-4" />
										Sync Facturi
									{/if}
								</Button>
								<Button variant="destructive" onclick={handleDisconnect} disabled={disconnecting}>
									<Unlink class="mr-2 h-4 w-4" />
									Deconectează
								</Button>
							{:else}
								<Button variant="outline" onclick={handleSaveConfig} disabled={savingConfig}>
									<Save class="mr-2 h-4 w-4" />
									Salvează Configurare
								</Button>
								<Button onclick={handleConnect}>
									<LinkIcon class="mr-2 h-4 w-4" />
									Conectează Google Ads
								</Button>
							{/if}
						</div>

						{#if status?.lastSyncAt}
							<div class="text-sm text-muted-foreground">
								Ultimul sync: {formatDate(status.lastSyncAt)}
								{#if status.lastSyncResults}
									— {status.lastSyncResults.imported} importate, {status.lastSyncResults.skipped || 0} existente, {status.lastSyncResults.errors || 0} erori
								{/if}
							</div>
						{/if}
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>

		<!-- Google Session Cookies Card -->
		<Collapsible bind:open={cookiesOpen}>
			<Card>
				<CollapsibleTrigger class="w-full text-left cursor-pointer">
					<CardHeader>
						<div class="flex items-center justify-between">
							<div>
								<CardTitle class="flex items-center gap-2">
									<Cookie class="h-5 w-5" />
									Sesiune Google (Cookies)
									{#if status?.googleSessionStatus === 'active'}
										<span class="inline-flex items-center rounded-full border border-green-500 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">
											Active
										</span>
									{:else if status?.googleSessionStatus === 'expired'}
										<span class="inline-flex items-center rounded-full border border-amber-500 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-50">
											Expirat
										</span>
									{:else}
										<span class="inline-flex items-center rounded-full border border-gray-400 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-50">
											Inactive
										</span>
									{/if}
								</CardTitle>
								<CardDescription>
									Cookies-urile Google sunt folosite ca fallback pentru descărcarea facturilor PDF de pe payments.google.com.
									Exportă cookies-urile de pe ads.google.com cu extensia Cookie-Editor (format JSON).
								</CardDescription>
							</div>
							<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {cookiesOpen ? 'rotate-180' : ''}" />
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent class="space-y-3">
						{#if status?.googleSessionStatus === 'active'}
							<p class="text-sm text-green-700">Sesiunea Google este activă. Cookies-urile vor fi folosite pentru descărcarea facturilor PDF.</p>
						{:else if status?.googleSessionStatus === 'expired'}
							<p class="text-xs text-amber-600">Sesiunea a expirat. Re-salvează cookies-urile pentru a reactiva descărcarea.</p>
						{/if}
						{#if status?.googleSessionStatus === 'active' || status?.googleSessionStatus === 'expired'}
							<Button variant="outline" size="sm" onclick={handleClearCookies}>
								<Trash2 class="mr-2 h-4 w-4" />
								Șterge Sesiune
							</Button>
						{/if}
						{#if status?.googleSessionStatus !== 'active'}
							<div class="space-y-2">
								<textarea
									class="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
									placeholder={'[{"name":"SID","value":"...","domain":".google.com"}, ...]'}
									bind:value={cookieJsonInput}
								></textarea>
								<Button size="sm" onclick={handleSaveCookies} disabled={savingCookies}>
									{#if savingCookies}
										<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
										Salvare...
									{:else}
										Salvează Cookies Google
									{/if}
								</Button>
							</div>
						{/if}
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>

		<!-- Account Mapping Card -->
		{#if status?.connected}
			<Collapsible bind:open={accountsOpen}>
				<Card>
					<CollapsibleTrigger class="w-full text-left cursor-pointer">
						<CardHeader>
							<div class="flex items-center justify-between">
								<div>
									<CardTitle>Conturi Google Ads → Clienți</CardTitle>
									<CardDescription>
										Atribuie conturile Google Ads din MCC la clienții din CRM. Apasă „Extrage Conturi Google Ads" pentru a aduce lista de conturi.
									</CardDescription>
								</div>
								<div class="flex items-center gap-2">
									{#if accounts.length > 0}
										<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">{accounts.length} conturi</span>
									{/if}
									<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {accountsOpen ? 'rotate-180' : ''}" />
								</div>
							</div>
						</CardHeader>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<CardContent>
							{#if accounts.length === 0}
								<div class="text-center py-6">
									<p class="text-sm text-muted-foreground mb-3">Nu sunt conturi Google Ads extrase.</p>
									<Button variant="outline" onclick={handleFetchAccounts} disabled={fetchingAccounts}>
										{#if fetchingAccounts}
											<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
											Extragere...
										{:else}
											<Download class="mr-2 h-4 w-4" />
											Extrage Conturi Google Ads
										{/if}
									</Button>
								</div>
							{:else}
								<div class="relative mb-4">
									<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										bind:value={accountSearch}
										type="text"
										placeholder="Caută cont sau Customer ID..."
										class="pl-9"
									/>
								</div>
								{#if filteredAccounts.length === 0}
									<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{accountSearch}"</p>
								{:else}
									<div class="rounded-md border">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Cont Google Ads</TableHead>
													<TableHead>Customer ID</TableHead>
													<TableHead>Client CRM</TableHead>
													<TableHead class="w-[100px]">Raport</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{#each filteredAccounts as account (account.id)}
													<TableRow>
														<TableCell class="font-medium">{account.accountName}</TableCell>
														<TableCell class="text-muted-foreground font-mono text-sm">
															{formatCustomerIdDisplay(account.googleAdsCustomerId)}
														</TableCell>
														<TableCell>
															<Combobox
																options={clientOptions}
																value={account.clientId || undefined}
																placeholder="— Neatribuit —"
																searchPlaceholder="Caută client..."
																clearable={true}
																clearLabel="— Neatribuit —"
																class="max-w-[250px]"
																onValueChange={(val) => handleAssignClient(account.id, String(val ?? ''))}
															/>
														</TableCell>
														<TableCell>
															<a
																href="/{tenantSlug}/reports/google-ads"
																class="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
															>
																<BarChart3 class="h-4 w-4" />
																Raport
															</a>
														</TableCell>
													</TableRow>
												{/each}
											</TableBody>
										</Table>
									</div>
								{/if}
							{/if}
						</CardContent>
					</CollapsibleContent>
				</Card>
			</Collapsible>
		{/if}
	{/if}
</div>
