<script lang="ts">
	import {
		getMetaAdsConnectionStatus,
		getMetaAdsAccounts,
		getClientsForMetaMapping,
		addMetaAdsConnection,
		removeMetaAdsConnection,
		fetchMetaAdsAccounts,
		assignMetaAdsAccountToClient,
		triggerMetaAdsSync,
		setMetaAdsCookies,
		clearMetaAdsCookies
	} from '$lib/remotes/meta-ads-invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { CheckCircle2, XCircle, Link as LinkIcon, Unlink, Plus, RefreshCw, Download, ChevronDown, ChevronUp, AlertTriangle, Trash2, BarChart3 } from '@lucide/svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import {
		getMetaAdsPages,
		fetchAvailablePages,
		addMetaAdsPage,
		removeMetaAdsPage,
		togglePageMonitoring,
		triggerLeadSync
	} from '$lib/remotes/leads.remote';

	const tenantSlug = $derived(page.params.tenant);

	const connectionsQuery = getMetaAdsConnectionStatus();
	const connections = $derived(connectionsQuery.current || []);
	const loading = $derived(connectionsQuery.loading);

	const clientsQuery = getClientsForMetaMapping();
	const clients = $derived(clientsQuery.current || []);
	const clientOptions = $derived(
		clients.map((c) => ({ value: c.id, label: c.businessName || c.name }))
	);

	// New BM form
	let newBusinessId = $state('');
	let newBusinessName = $state('');
	let addingConnection = $state(false);
	let syncing = $state(false);

	// Expanded state per integration
	let expandedIntegrations = $state<Set<string>>(new Set());

	// Accounts cache per integration
	let accountsCache = $state<Record<string, any[]>>({});
	let fetchingAccountsFor = $state<string | null>(null);

	// Collapsible states
	let addFormOpen = $state(true);
	let accountSearches = $state<Record<string, string>>({});

	// Cookie management
	let cookieJsonInputs = $state<Record<string, string>>({});
	let savingCookiesFor = $state<string | null>(null);

	// Lead Pages
	const pagesQuery = getMetaAdsPages();
	const monitoredPages = $derived(pagesQuery.current || []);
	let availablePages = $state<Array<{ pageId: string; pageName: string; pageAccessToken: string }>>([]);
	let fetchingPages = $state(false);
	let fetchingForIntegration = $state<string | null>(null);
	let syncingLeads = $state(false);
	let addingPage = $state<string | null>(null);

	async function handleSaveCookies(integrationId: string) {
		const json = cookieJsonInputs[integrationId]?.trim();
		if (!json) {
			clientLogger.warn({ message: 'Inserează JSON-ul cookies din Cookie-Editor', action: 'meta_ads_save_cookies' });
			return;
		}
		savingCookiesFor = integrationId;
		try {
			await setMetaAdsCookies({ integrationId, cookiesJson: json }).updates(connectionsQuery);
			toast.success('Cookies Facebook salvate');
			cookieJsonInputs = { ...cookieJsonInputs, [integrationId]: '' };
		} catch (e: any) {
			clientLogger.apiError('meta_ads_save_cookies', e);
		} finally {
			savingCookiesFor = null;
		}
	}

	async function handleClearCookies(integrationId: string) {
		if (!confirm('Ștergi sesiunea Facebook? Download-ul facturilor nu va mai funcționa.')) return;
		try {
			await clearMetaAdsCookies(integrationId).updates(connectionsQuery);
			toast.success('Sesiune Facebook ștearsă');
		} catch (e: any) {
			clientLogger.apiError('meta_ads_clear_cookies', e);
		}
	}

	// URL params from OAuth callback
	const urlSuccess = $derived(page.url.searchParams.get('success') === 'true');
	const urlError = $derived(page.url.searchParams.get('error'));

	function toggleExpand(id: string) {
		const next = new Set(expandedIntegrations);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
			// Auto-fetch accounts when expanding
			if (!accountsCache[id]) {
				loadAccounts(id);
			}
		}
		expandedIntegrations = next;
	}

	async function loadAccounts(integrationId: string) {
		try {
			const accounts = await getMetaAdsAccounts(integrationId);
			accountsCache = { ...accountsCache, [integrationId]: accounts };
		} catch (e) {
			clientLogger.apiError('meta_ads_load_accounts', e);
		}
	}

	async function handleAddConnection() {
		if (!newBusinessId.trim() || !newBusinessName.trim()) {
			clientLogger.warn({ message: 'Completează Business Manager ID și Nume', action: 'meta_ads_add_connection' });
			return;
		}

		addingConnection = true;
		try {
			const result = await addMetaAdsConnection({
				businessId: newBusinessId,
				businessName: newBusinessName
			}).updates(connectionsQuery);
			toast.success(result.created ? 'Conexiune adăugată' : 'Conexiune actualizată');
			newBusinessId = '';
			newBusinessName = '';
		} catch (e) {
			clientLogger.apiError('meta_ads_add_connection', e);
		} finally {
			addingConnection = false;
		}
	}

	async function handleConnect(integrationId: string) {
		window.location.href = `/api/meta-ads/auth?tenant=${tenantSlug}&integration=${integrationId}`;
	}

	let disconnecting = $state(false);

	async function handleDisconnect(integrationId: string) {
		if (!confirm('Ești sigur că vrei să deconectezi acest Business Manager?')) return;

		disconnecting = true;
		try {
			const res = await fetch(`/api/meta-ads/disconnect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ integrationId })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Eroare la deconectare');
			}
			toast.success('Business Manager deconectat');
			// Refresh connections query instead of page reload
			connectionsQuery.refresh();
		} catch (e) {
			clientLogger.apiError('meta_ads_disconnect', e);
		} finally {
			disconnecting = false;
		}
	}

	async function handleRemove(integrationId: string) {
		if (!confirm('Ești sigur că vrei să ștergi această conexiune? Toate conturile asociate vor fi șterse.')) return;

		try {
			await removeMetaAdsConnection(integrationId).updates(connectionsQuery);
			toast.success('Conexiune ștearsă');
		} catch (e: any) {
			clientLogger.apiError('meta_ads_remove_connection', e);
		}
	}

	async function handleFetchAccounts(integrationId: string) {
		fetchingAccountsFor = integrationId;
		try {
			const result = await fetchMetaAdsAccounts(integrationId);
			toast.success(`${result.fetched} conturi Meta Ads găsite`);
			await loadAccounts(integrationId);
		} catch (e) {
			clientLogger.apiError('meta_ads_fetch_accounts', e);
		} finally {
			fetchingAccountsFor = null;
		}
	}

	async function handleAssignClient(accountId: string, clientId: string, integrationId: string) {
		try {
			await assignMetaAdsAccountToClient({
				accountId,
				clientId: clientId || null
			});
			toast.success('Client atribuit');
			await loadAccounts(integrationId);
		} catch (e) {
			clientLogger.apiError('meta_ads_assign_client', e);
		}
	}

	async function handleSyncAll() {
		syncing = true;
		try {
			const result = await triggerMetaAdsSync().updates(connectionsQuery);
			toast.success(`Sync complet: ${result.imported} noi, ${result.updated || 0} actualizate, ${result.errors} erori`);
		} catch (e) {
			clientLogger.apiError('meta_ads_sync', e);
		} finally {
			syncing = false;
		}
	}

	async function handleFetchPages(integrationId: string) {
		fetchingPages = true;
		fetchingForIntegration = integrationId;
		try {
			availablePages = await fetchAvailablePages(integrationId);
			toast.success(`${availablePages.length} pagini găsite`);
		} catch (e) {
			toast.error('Eroare la preluarea paginilor. Verificați dacă token-ul include permisiunea leads_retrieval.');
			availablePages = [];
		} finally {
			fetchingPages = false;
		}
	}

	async function handleAddPage(integrationId: string, pg: { pageId: string; pageName: string; pageAccessToken: string }) {
		addingPage = pg.pageId;
		try {
			await addMetaAdsPage({
				integrationId,
				metaPageId: pg.pageId,
				pageName: pg.pageName,
				pageAccessToken: pg.pageAccessToken
			});
			toast.success(`Pagina "${pg.pageName}" adăugată`);
			pagesQuery.refetch();
		} catch (e) {
			toast.error('Eroare la adăugarea paginii');
		} finally {
			addingPage = null;
		}
	}

	async function handleRemovePage(pageId: string) {
		try {
			await removeMetaAdsPage(pageId);
			toast.success('Pagina eliminată');
			pagesQuery.refetch();
		} catch (e) {
			toast.error('Eroare la eliminare');
		}
	}

	async function handleToggleMonitoring(pageId: string, isMonitored: boolean) {
		try {
			await togglePageMonitoring({ pageId, isMonitored: !isMonitored });
			toast.success(isMonitored ? 'Monitorizare dezactivată' : 'Monitorizare activată');
			pagesQuery.refetch();
		} catch (e) {
			toast.error('Eroare la actualizare');
		}
	}

	async function handleSyncLeads() {
		syncingLeads = true;
		try {
			const result = await triggerLeadSync({ platform: 'facebook' });
			toast.success(`Sync leaduri: ${result.imported} noi, ${result.skipped} existente`);
		} catch (e) {
			toast.error('Sync leaduri eșuat');
		} finally {
			syncingLeads = false;
		}
	}

	function isPageAlreadyAdded(metaPageId: string): boolean {
		return monitoredPages.some((p: any) => p.metaPageId === metaPageId);
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
			<h1 class="text-3xl font-bold">Meta Ads</h1>
			<p class="text-muted-foreground">Configurare integrare Meta/Facebook Ads pentru rapoarte cheltuieli automate</p>
		</div>
		{#if connections.some((c: any) => c.connected)}
			<div class="flex flex-col items-end gap-1">
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" onclick={handleSyncAll} disabled={syncing}>
						{#if syncing}
							<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
							Sincronizare...
						{:else}
							<RefreshCw class="mr-2 h-4 w-4" />
							Sync Cheltuieli
						{/if}
					</Button>
					<Button variant="outline" size="sm" onclick={handleSyncLeads} disabled={syncingLeads}>
						{#if syncingLeads}
							<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
							Sync Leads...
						{:else}
							<RefreshCw class="mr-2 h-4 w-4" />
							Sync Leads
						{/if}
					</Button>
				</div>
				{#if connections.find((c: any) => c.lastSyncAt)}
					{@const lastSync = connections.find((c: any) => c.lastSyncAt)}
					<p class="text-xs text-muted-foreground">
						Sync: {formatDate(lastSync.lastSyncAt)}
						{#if lastSync.lastSyncResults}
							— {lastSync.lastSyncResults.imported ?? 0} noi, {lastSync.lastSyncResults.updated ?? 0} actualizate, {lastSync.lastSyncResults.errors ?? 0} erori
						{/if}
					</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if urlSuccess}
		<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
			<p class="text-sm text-green-800 dark:text-green-200">Conectare Meta Ads reușită!</p>
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
		<!-- Add New Business Manager -->
		<Collapsible bind:open={addFormOpen}>
			<Card>
				<CollapsibleTrigger class="w-full text-left cursor-pointer">
					<CardHeader>
						<div class="flex items-center justify-between">
							<div>
								<CardTitle>Adaugă Business Manager</CardTitle>
								<CardDescription>
									Conectează un Business Manager Meta pentru a sincroniza cheltuielile. Poți adăuga mai multe BM-uri.
								</CardDescription>
							</div>
							<ChevronDown class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {addFormOpen ? 'rotate-180' : ''}" />
						</div>
					</CardHeader>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent class="space-y-4">
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-2">
								<Label for="bm-id">Business Manager ID</Label>
								<Input
									id="bm-id"
									type="text"
									placeholder="123456789012345"
									bind:value={newBusinessId}
								/>
								<p class="text-xs text-muted-foreground">ID-ul din Meta Business Suite</p>
							</div>
							<div class="space-y-2">
								<Label for="bm-name">Nume Business Manager</Label>
								<Input
									id="bm-name"
									type="text"
									placeholder="Numele companiei / BM"
									bind:value={newBusinessName}
								/>
							</div>
						</div>
						<Button onclick={handleAddConnection} disabled={addingConnection}>
							{#if addingConnection}
								<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
							{:else}
								<Plus class="mr-2 h-4 w-4" />
							{/if}
							Adaugă
						</Button>
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>

		<!-- Existing Connections -->
		{#if connections.length > 0}
			<div class="space-y-4">
				<h2 class="text-xl font-semibold">Conexiuni ({connections.length})</h2>
				{#each connections as conn (conn.id)}
					<Card>
						<CardHeader class="cursor-pointer" onclick={() => toggleExpand(conn.id)}>
							<div class="flex items-center justify-between">
								<CardTitle class="flex items-center gap-2 text-base">
									{#if conn.connected}
										<CheckCircle2 class="h-5 w-5 text-green-500" />
									{:else}
										<XCircle class="h-5 w-5 text-red-500" />
									{/if}
									{conn.businessName || conn.businessId}
									{#if conn.tokenExpiringSoon && !conn.tokenExpired}
										<span class="inline-flex items-center gap-1 rounded-full border border-yellow-500 bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700">
											<AlertTriangle class="h-3 w-3" />
											Token expiră curând
										</span>
									{/if}
									{#if conn.tokenExpired}
										<span class="inline-flex items-center gap-1 rounded-full border border-red-500 bg-red-50 px-2 py-0.5 text-xs text-red-700">
											<AlertTriangle class="h-3 w-3" />
											Token expirat
										</span>
									{/if}
								</CardTitle>
								<div class="flex items-center gap-2">
									<span class="text-sm text-muted-foreground font-mono">{conn.businessId}</span>
									{#if expandedIntegrations.has(conn.id)}
										<ChevronUp class="h-4 w-4" />
									{:else}
										<ChevronDown class="h-4 w-4" />
									{/if}
								</div>
							</div>
							{#if conn.connected && conn.email}
								<CardDescription>Conectat cu {conn.email}</CardDescription>
							{/if}
						</CardHeader>

						{#if expandedIntegrations.has(conn.id)}
							<CardContent class="space-y-4">
								{#if conn.lastSyncAt}
									<div class="text-sm text-muted-foreground">
										Ultimul sync: {formatDate(conn.lastSyncAt)}
										{#if conn.lastSyncResults}
											— {conn.lastSyncResults.imported} noi, {conn.lastSyncResults.updated || 0} actualizate, {conn.lastSyncResults.errors || 0} erori
											{#if conn.lastSyncResults.accountsTotal != null}
												<span class="text-xs ml-1">({conn.lastSyncResults.accountsWithClient || 0} conturi cu client din {conn.lastSyncResults.accountsTotal} total)</span>
											{/if}
										{/if}
									</div>
								{/if}

								<div class="flex items-center gap-2 flex-wrap">
									{#if conn.connected}
										<Button variant="outline" onclick={() => handleConnect(conn.id)}>
											<RefreshCw class="mr-2 h-4 w-4" />
											Reconectează
										</Button>
										<Button variant="outline" onclick={() => handleFetchAccounts(conn.id)} disabled={fetchingAccountsFor === conn.id}>
											{#if fetchingAccountsFor === conn.id}
												<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
												Extragere...
											{:else}
												<Download class="mr-2 h-4 w-4" />
												Extrage Conturi
											{/if}
										</Button>
										<Button variant="outline" onclick={() => handleDisconnect(conn.id)}>
											<Unlink class="mr-2 h-4 w-4" />
											Deconectează
										</Button>
									{:else}
										<Button onclick={() => handleConnect(conn.id)}>
											<LinkIcon class="mr-2 h-4 w-4" />
											Conectează
										</Button>
									{/if}
									<Button variant="destructive" size="sm" onclick={() => handleRemove(conn.id)}>
										<Trash2 class="mr-2 h-4 w-4" />
										Șterge
									</Button>
								</div>

								<!-- Account Mapping Table -->
								{#if conn.connected && accountsCache[conn.id]}
									<Separator />
									<div>
										<h3 class="text-sm font-semibold mb-2">Conturi Ad → Clienți CRM</h3>
										{#if accountsCache[conn.id].length === 0}
											<p class="text-sm text-muted-foreground">Nu sunt conturi extrase. Apasă „Extrage Conturi".</p>
										{:else}
											{@const searchTerm = (accountSearches[conn.id] || '').trim().toLowerCase()}
											{@const filteredAccs = searchTerm
												? accountsCache[conn.id].filter((a: any) =>
													(a.accountName || '').toLowerCase().includes(searchTerm) ||
													a.metaAdAccountId.includes(searchTerm)
												)
												: accountsCache[conn.id]}
											<div class="relative mb-3">
												<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
												<Input
													value={accountSearches[conn.id] || ''}
													oninput={(e) => { accountSearches = { ...accountSearches, [conn.id]: e.currentTarget.value }; }}
													type="text"
													placeholder="Caută cont sau Ad Account ID..."
													class="pl-9"
												/>
											</div>
											{#if filteredAccs.length === 0}
												<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{accountSearches[conn.id]}"</p>
											{:else}
												<div class="rounded-md border">
													<Table>
														<TableHeader>
															<TableRow>
																<TableHead>Cont Meta Ads</TableHead>
																<TableHead>Ad Account ID</TableHead>
																<TableHead>Client CRM</TableHead>
																<TableHead class="w-[100px]">Raport</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{#each filteredAccs as account (account.id)}
																<TableRow>
																	<TableCell class="font-medium">{account.accountName || '-'}</TableCell>
																	<TableCell class="text-muted-foreground font-mono text-sm">
																		{account.metaAdAccountId}
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
																			onValueChange={(val) => handleAssignClient(account.id, String(val ?? ''), conn.id)}
																		/>
																	</TableCell>
																	<TableCell>
																		<a
																			href="/{tenantSlug}/reports/facebook-ads"
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
									</div>
								{/if}

								<!-- Facebook Session Cookies (for invoice PDF download) -->
								{#if conn.connected}
									<Separator />
									<div class="space-y-3">
										<div class="flex items-center gap-2">
											<h3 class="text-sm font-semibold">Sesiune Facebook (Facturi PDF)</h3>
											{#if conn.fbSessionStatus === 'active'}
												<span class="inline-flex items-center rounded-full border border-green-500 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">
													Active
												</span>
											{:else if conn.fbSessionStatus === 'expired'}
												<span class="inline-flex items-center rounded-full border border-amber-500 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-50">
													Expirat
												</span>
											{:else}
												<span class="inline-flex items-center rounded-full border border-gray-400 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-50">
													Lipsă
												</span>
											{/if}
										</div>
										<p class="text-xs text-muted-foreground">
											Exportă cookies-urile de pe facebook.com cu extensia „Cookie-Editor" (format JSON) și inserează-le aici.
											Sunt necesare pentru descărcarea automată a facturilor PDF.
										</p>
										{#if conn.fbSessionStatus === 'active' || conn.fbSessionStatus === 'expired'}
											<Button variant="outline" size="sm" onclick={() => handleClearCookies(conn.id)}>
												<Trash2 class="mr-2 h-4 w-4" />
												Șterge Sesiune
											</Button>
										{/if}
										{#if conn.fbSessionStatus !== 'active'}
											<div class="space-y-2">
												{#if conn.fbSessionStatus === 'expired'}
													<p class="text-xs text-amber-600">Sesiunea a expirat. Re-salvează cookies-urile pentru a reactiva descărcarea.</p>
												{/if}
												<textarea
													class="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
													placeholder={'[{"name":"c_user","value":"...","domain":".facebook.com"}, ...]'}
													value={cookieJsonInputs[conn.id] || ''}
													oninput={(e) => { cookieJsonInputs = { ...cookieJsonInputs, [conn.id]: e.currentTarget.value }; }}
												></textarea>
												<Button size="sm" onclick={() => handleSaveCookies(conn.id)} disabled={savingCookiesFor === conn.id}>
													{#if savingCookiesFor === conn.id}
														<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
														Salvare...
													{:else}
														Salvează Cookies
													{/if}
												</Button>
											</div>
										{/if}
									</div>
								{/if}
							</CardContent>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}

		<!-- Lead Pages Section -->
		{#if connections.some((c: any) => c.connected)}
			<Separator />
			<div class="space-y-4">
				<h2 class="text-xl font-semibold">Pagini Facebook — Lead Ads</h2>
				<p class="text-sm text-muted-foreground">
					Selectează paginile Facebook de pe care se sincronizează leadurile din formularele Lead Ads.
				</p>

				<!-- Monitored Pages Table -->
				<Card>
					<CardHeader>
						<CardTitle class="text-base">Pagini monitorizate</CardTitle>
						<CardDescription>Paginile Facebook de pe care se sincronizează leadurile</CardDescription>
					</CardHeader>
					<CardContent>
						{#if monitoredPages.length === 0}
							<p class="text-sm text-muted-foreground py-4 text-center">
								Nicio pagină adăugată încă. Folosiți butonul "Preia Pagini" de mai jos.
							</p>
						{:else}
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Pagina</TableHead>
										<TableHead>Business Manager</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Ultimul Sync</TableHead>
										<TableHead class="w-[120px]">Acțiuni</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{#each monitoredPages as pg (pg.id)}
										<TableRow>
											<TableCell class="font-medium">{pg.pageName}</TableCell>
											<TableCell class="text-sm text-muted-foreground">{pg.businessName || '-'}</TableCell>
											<TableCell>
												{#if pg.isMonitored}
													<Badge variant="default" class="gap-1">
														<CheckCircle2 class="h-3 w-3" />
														Activ
													</Badge>
												{:else}
													<Badge variant="secondary" class="gap-1">
														<XCircle class="h-3 w-3" />
														Inactiv
													</Badge>
												{/if}
											</TableCell>
											<TableCell class="text-sm text-muted-foreground">{formatDate(pg.lastLeadSyncAt)}</TableCell>
											<TableCell>
												<div class="flex items-center gap-1">
													<Button
														variant="ghost"
														size="sm"
														onclick={() => handleToggleMonitoring(pg.id, pg.isMonitored)}
													>
														{pg.isMonitored ? 'Dezactivează' : 'Activează'}
													</Button>
													<Button
														variant="ghost"
														size="icon"
														class="h-8 w-8 text-destructive"
														onclick={() => handleRemovePage(pg.id)}
													>
														<Trash2 class="h-4 w-4" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									{/each}
								</TableBody>
							</Table>
						{/if}
					</CardContent>
				</Card>

				<!-- Fetch & Add Pages per connection -->
				{#each connections.filter((c: any) => c.connected) as conn (conn.id)}
					<Card>
						<CardHeader>
							<CardTitle class="text-base">Adaugă pagini din: {conn.businessName || conn.businessId}</CardTitle>
							<CardDescription>Preia lista de pagini Facebook din acest Business Manager</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4">
							<Button
								onclick={() => handleFetchPages(conn.id)}
								disabled={fetchingPages}
								variant="outline"
								size="sm"
							>
								{#if fetchingPages && fetchingForIntegration === conn.id}
									<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
									Extragere...
								{:else}
									<Download class="mr-2 h-4 w-4" />
									Preia Pagini
								{/if}
							</Button>

							{#if fetchingForIntegration === conn.id && availablePages.length > 0}
								<Separator />
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Pagina</TableHead>
											<TableHead>Page ID</TableHead>
											<TableHead class="w-[120px]">Acțiune</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{#each availablePages as pg (pg.pageId)}
											<TableRow>
												<TableCell class="font-medium">{pg.pageName}</TableCell>
												<TableCell class="text-sm text-muted-foreground font-mono">{pg.pageId}</TableCell>
												<TableCell>
													{#if isPageAlreadyAdded(pg.pageId)}
														<Badge variant="secondary">Adăugată</Badge>
													{:else}
														<Button
															size="sm"
															variant="outline"
															disabled={addingPage === pg.pageId}
															onclick={() => handleAddPage(conn.id, pg)}
														>
															<Plus class="mr-2 h-4 w-4" />
															{addingPage === pg.pageId ? 'Se adaugă...' : 'Adaugă'}
														</Button>
													{/if}
												</TableCell>
											</TableRow>
										{/each}
									</TableBody>
								</Table>
							{/if}
						</CardContent>
					</Card>
				{/each}

				<!-- Info box -->
				<div class="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground space-y-1">
					<p>Dacă nu vedeți paginile, asigurați-vă că:</p>
					<ul class="list-disc pl-5 space-y-0.5">
						<li>Contul Meta Ads este reconectat cu permisiunile noi (leads_retrieval, pages_read_engagement)</li>
						<li>Utilizatorul are acces de administrator pe paginile respective</li>
						<li>Paginile au formulare Lead Ads active</li>
					</ul>
				</div>
			</div>
		{/if}
	{/if}
</div>
