<script lang="ts">
	import {
		getTiktokAdsConnectionStatus,
		getTiktokAdsAccounts,
		getClientsForTiktokMapping,
		addTiktokAdsConnection,
		removeTiktokAdsConnection,
		fetchTiktokAdsAccounts,
		assignTiktokAdsAccountToClient,
		triggerTiktokAdsSync,
		setTiktokAdsCookies,
		clearTiktokAdsCookies
	} from '$lib/remotes/tiktok-ads.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import { CheckCircle2, XCircle, Link as LinkIcon, Unlink, Plus, RefreshCw, Download, ChevronDown, ChevronUp, AlertTriangle, Trash2 } from '@lucide/svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	const connectionsQuery = getTiktokAdsConnectionStatus();
	const connections = $derived(connectionsQuery.current || []);
	const loading = $derived(connectionsQuery.loading);

	const clientsQuery = getClientsForTiktokMapping();
	const clients = $derived(clientsQuery.current || []);

	// New connection form
	let newOrgId = $state('');
	let newPaymentAccountId = $state('');
	let addingConnection = $state(false);
	let syncing = $state(false);

	// Expanded state per integration
	let expandedIntegrations = $state<Set<string>>(new Set());

	// Accounts cache per integration
	let accountsCache = $state<Record<string, any[]>>({});
	let fetchingAccountsFor = $state<string | null>(null);

	// Cookie management
	let cookieJsonInputs = $state<Record<string, string>>({});
	let savingCookiesFor = $state<string | null>(null);

	async function handleSaveCookies(integrationId: string) {
		const json = cookieJsonInputs[integrationId]?.trim();
		if (!json) {
			toast.error('Inserează JSON-ul cookies din Cookie-Editor');
			return;
		}
		savingCookiesFor = integrationId;
		try {
			await setTiktokAdsCookies({ integrationId, cookiesJson: json }).updates(connectionsQuery);
			toast.success('Cookies TikTok salvate');
			cookieJsonInputs = { ...cookieJsonInputs, [integrationId]: '' };
		} catch (e: any) {
			const msg = e?.body?.message || e?.message || 'Eroare la salvare cookies';
			toast.error(msg);
		} finally {
			savingCookiesFor = null;
		}
	}

	async function handleClearCookies(integrationId: string) {
		if (!confirm('Ștergi sesiunea TikTok? Download-ul facturilor nu va mai funcționa.')) return;
		try {
			await clearTiktokAdsCookies(integrationId).updates(connectionsQuery);
			toast.success('Sesiune TikTok ștearsă');
		} catch (e: any) {
			toast.error(e?.body?.message || (e instanceof Error ? e.message : 'Eroare la ștergere sesiune'));
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
			if (!accountsCache[id]) {
				loadAccounts(id);
			}
		}
		expandedIntegrations = next;
	}

	async function loadAccounts(integrationId: string) {
		try {
			const accounts = await getTiktokAdsAccounts(integrationId);
			accountsCache = { ...accountsCache, [integrationId]: accounts };
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la încărcare conturi');
		}
	}

	async function handleAddConnection() {
		addingConnection = true;
		try {
			const result = await addTiktokAdsConnection({
				orgId: newOrgId,
				paymentAccountId: newPaymentAccountId
			}).updates(connectionsQuery);
			toast.success(result.created ? 'Conexiune adăugată' : 'Conexiune actualizată');
			newOrgId = '';
			newPaymentAccountId = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la adăugare');
		} finally {
			addingConnection = false;
		}
	}

	async function handleConnect(integrationId: string) {
		window.location.href = `/api/tiktok-ads/auth?tenant=${tenantSlug}&integration=${integrationId}`;
	}

	let disconnecting = $state(false);

	async function handleDisconnect(integrationId: string) {
		if (!confirm('Ești sigur că vrei să deconectezi această integrare TikTok Ads?')) return;

		disconnecting = true;
		try {
			const res = await fetch(`/api/tiktok-ads/disconnect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ integrationId })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'Eroare la deconectare');
			}
			toast.success('TikTok Ads deconectat');
			connectionsQuery.revalidate();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la deconectare');
		} finally {
			disconnecting = false;
		}
	}

	async function handleRemove(integrationId: string) {
		if (!confirm('Ești sigur că vrei să ștergi această conexiune? Toate conturile asociate vor fi șterse.')) return;

		try {
			await removeTiktokAdsConnection(integrationId).updates(connectionsQuery);
			toast.success('Conexiune ștearsă');
		} catch (e: any) {
			toast.error(e?.body?.message || (e instanceof Error ? e.message : 'Eroare la ștergere'));
		}
	}

	async function handleFetchAccounts(integrationId: string) {
		fetchingAccountsFor = integrationId;
		try {
			const result = await fetchTiktokAdsAccounts(integrationId);
			toast.success(`${result.fetched} conturi TikTok Ads găsite`);
			await loadAccounts(integrationId);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la extragere conturi');
		} finally {
			fetchingAccountsFor = null;
		}
	}

	async function handleAssignClient(accountId: string, clientId: string, integrationId: string) {
		try {
			await assignTiktokAdsAccountToClient({
				accountId,
				clientId: clientId || null
			});
			toast.success('Client atribuit');
			await loadAccounts(integrationId);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la atribuire');
		}
	}

	async function handleSyncAll() {
		syncing = true;
		try {
			const result = await triggerTiktokAdsSync().updates(connectionsQuery);
			toast.success(`Sync complet: ${result.imported} noi, ${result.updated || 0} actualizate, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sincronizare');
		} finally {
			syncing = false;
		}
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
			<h1 class="text-3xl font-bold">TikTok Ads</h1>
			<p class="text-muted-foreground">Configurare integrare TikTok Ads pentru rapoarte cheltuieli automate</p>
		</div>
		{#if connections.some((c: any) => c.connected)}
			<Button variant="outline" size="sm" onclick={handleSyncAll} disabled={syncing}>
				{#if syncing}
					<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
					Sincronizare...
				{:else}
					<RefreshCw class="mr-2 h-4 w-4" />
					Sync Toate
				{/if}
			</Button>
		{/if}
	</div>

	{#if urlSuccess}
		<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
			<p class="text-sm text-green-800 dark:text-green-200">Conectare TikTok Ads reușită!</p>
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
		<!-- Add New Connection -->
		<Card>
			<CardHeader>
				<CardTitle>Adaugă Conexiune TikTok Ads</CardTitle>
				<CardDescription>
					Conectează un cont TikTok Ads pentru a sincroniza cheltuielile. Opțional: completează Org ID și Payment Account ID pentru descărcarea facturilor.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="org-id">Org ID (bc_id) — opțional</Label>
						<Input
							id="org-id"
							type="text"
							placeholder="7475313915279360017"
							bind:value={newOrgId}
						/>
						<p class="text-xs text-muted-foreground">Business Center ID din TikTok (necesar pentru facturi)</p>
					</div>
					<div class="space-y-2">
						<Label for="pa-id">Payment Account ID (pa_id) — opțional</Label>
						<Input
							id="pa-id"
							type="text"
							placeholder="7475316046057210631"
							bind:value={newPaymentAccountId}
						/>
						<p class="text-xs text-muted-foreground">ID-ul contului de plăți din TikTok Billing</p>
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
		</Card>

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
									TikTok Ads {conn.orgId ? `(org: ${conn.orgId})` : ''}
									{#if conn.tokenExpired}
										<span class="inline-flex items-center gap-1 rounded-full border border-red-500 bg-red-50 px-2 py-0.5 text-xs text-red-700">
											<AlertTriangle class="h-3 w-3" />
											Token expirat
										</span>
									{:else if conn.refreshTokenExpired}
										<span class="inline-flex items-center gap-1 rounded-full border border-red-500 bg-red-50 px-2 py-0.5 text-xs text-red-700">
											<AlertTriangle class="h-3 w-3" />
											Refresh token expirat
										</span>
									{/if}
								</CardTitle>
								<div class="flex items-center gap-2">
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
										{/if}
									</div>
								{/if}

								<div class="flex items-center gap-2 flex-wrap">
									{#if conn.connected}
										{#if conn.tokenExpired || conn.refreshTokenExpired}
											<Button onclick={() => handleConnect(conn.id)}>
												<RefreshCw class="mr-2 h-4 w-4" />
												Reconectează
											</Button>
										{/if}
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
										<h3 class="text-sm font-semibold mb-2">Conturi Advertiser → Clienți CRM</h3>
										{#if accountsCache[conn.id].length === 0}
											<p class="text-sm text-muted-foreground">Nu sunt conturi extrase. Apasă „Extrage Conturi".</p>
										{:else}
											<div class="rounded-md border">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>Cont TikTok Ads</TableHead>
															<TableHead>Advertiser ID</TableHead>
															<TableHead>Client CRM</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{#each accountsCache[conn.id] as account}
															<TableRow>
																<TableCell class="font-medium">{account.accountName || '-'}</TableCell>
																<TableCell class="text-muted-foreground font-mono text-sm">
																	{account.tiktokAdvertiserId}
																</TableCell>
																<TableCell>
																	<select
																		class="h-9 w-full max-w-[250px] rounded-md border border-input bg-background px-3 text-sm"
																		value={account.clientId || ''}
																		onchange={(e) => handleAssignClient(account.id, e.currentTarget.value, conn.id)}
																	>
																		<option value="">— Neatribuit —</option>
																		{#each clients as client}
																			<option value={client.id}>{client.name}</option>
																		{/each}
																	</select>
																</TableCell>
															</TableRow>
														{/each}
													</TableBody>
												</Table>
											</div>
										{/if}
									</div>
								{/if}

								<!-- TikTok Session Cookies (for invoice PDF download) -->
								{#if conn.connected}
									<Separator />
									<div class="space-y-3">
										<div class="flex items-center gap-2">
											<h3 class="text-sm font-semibold">Sesiune TikTok (Facturi PDF)</h3>
											{#if conn.ttSessionStatus === 'active'}
												<span class="inline-flex items-center rounded-full border border-green-500 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">
													Active
												</span>
											{:else}
												<span class="inline-flex items-center rounded-full border border-gray-400 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-50">
													Lipsă
												</span>
											{/if}
										</div>
										<p class="text-xs text-muted-foreground">
											Exportă cookies-urile de pe business.tiktok.com cu extensia „Cookie-Editor" (format JSON) și inserează-le aici.
											Cookie-ul necesar: <code class="bg-muted px-1 rounded">sessionid</code>. Necesare pentru descărcarea automată a facturilor PDF.
										</p>
										{#if conn.ttSessionStatus === 'active'}
											<Button variant="outline" size="sm" onclick={() => handleClearCookies(conn.id)}>
												<Trash2 class="mr-2 h-4 w-4" />
												Șterge Sesiune
											</Button>
										{:else}
											<div class="space-y-2">
												<textarea
													class="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
													placeholder={'[{"name":"sessionid","value":"...","domain":".tiktok.com"}, ...]'}
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
	{/if}
</div>
