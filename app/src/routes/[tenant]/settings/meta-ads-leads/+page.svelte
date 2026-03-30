<script lang="ts">
	import {
		getMetaAdsConnectionStatus
	} from '$lib/remotes/meta-ads-invoices.remote';
	import {
		getMetaAdsPages,
		fetchAvailablePages,
		addMetaAdsPage,
		removeMetaAdsPage,
		togglePageMonitoring,
		triggerLeadSync
	} from '$lib/remotes/leads.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import { CheckCircle2, XCircle, Plus, RefreshCw, Trash2, AlertTriangle } from '@lucide/svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	// Connections (reuse from meta-ads-invoices)
	const connectionsQuery = getMetaAdsConnectionStatus();
	const connections = $derived(connectionsQuery.current || []);
	const connectionsLoading = $derived(connectionsQuery.loading);

	// Monitored pages
	const pagesQuery = getMetaAdsPages();
	const monitoredPages = $derived(pagesQuery.current || []);

	// Available pages from API
	let availablePages = $state<Array<{ pageId: string; pageName: string; pageAccessToken: string }>>([]);
	let fetchingPages = $state(false);
	let fetchingForIntegration = $state<string | null>(null);
	let syncing = $state(false);
	let addingPage = $state<string | null>(null);

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

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerLeadSync({ platform: 'facebook' });
			toast.success(`Sync finalizat: ${result.imported} noi, ${result.skipped} existente`);
		} catch (e) {
			toast.error('Sync eșuat');
		} finally {
			syncing = false;
		}
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return 'Niciodată';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function isPageAlreadyAdded(metaPageId: string): boolean {
		return monitoredPages.some((p: any) => p.metaPageId === metaPageId);
	}
</script>

<div class="space-y-6 max-w-4xl">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold flex items-center gap-3">
				<IconFacebook class="h-7 w-7" />
				Facebook Leads - Setări
			</h1>
			<p class="text-muted-foreground">Configurează paginile Facebook pentru sincronizarea leadurilor</p>
		</div>
		<Button onclick={handleSync} disabled={syncing} variant="outline" size="sm">
			<RefreshCw class="h-4 w-4 {syncing ? 'animate-spin' : ''}" />
			{syncing ? 'Se sincronizează...' : 'Sync Leads'}
		</Button>
	</div>

	<!-- No connections warning -->
	{#if !connectionsLoading && connections.length === 0}
		<Card>
			<CardContent class="flex items-center gap-3 py-6">
				<AlertTriangle class="h-5 w-5 text-destructive shrink-0" />
				<div>
					<p class="font-medium">Nicio conexiune Meta Ads activă</p>
					<p class="text-sm text-muted-foreground">
						Trebuie mai întâi să conectați un Business Manager din
						<a href="/{tenantSlug}/settings/meta-ads" class="text-primary hover:underline">Setări Meta Ads</a>.
					</p>
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Monitored Pages -->
	<Card>
		<CardHeader>
			<CardTitle>Pagini monitorizate</CardTitle>
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

	<!-- Fetch & Add Pages -->
	{#each connections as conn (conn.id)}
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
					<RefreshCw class="h-4 w-4 {fetchingPages && fetchingForIntegration === conn.id ? 'animate-spin' : ''}" />
					Preia Pagini
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
									<TableCell class="text-sm text-muted-foreground">{pg.pageId}</TableCell>
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
												<Plus class="h-4 w-4" />
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

	<!-- Info -->
	<Card>
		<CardHeader>
			<CardTitle class="text-base">Informații</CardTitle>
		</CardHeader>
		<CardContent class="text-sm text-muted-foreground space-y-2">
			<p>Leadurile se sincronizează din formularele Lead Ads asociate paginilor monitorizate.</p>
			<p>Dacă nu vedeți paginile, asigurați-vă că:</p>
			<ul class="list-disc pl-5 space-y-1">
				<li>Contul Meta Ads este reconectat cu permisiunile noi (leads_retrieval, pages_read_engagement)</li>
				<li>Utilizatorul are acces de administrator pe paginile respective</li>
				<li>Paginile au formulare Lead Ads active</li>
			</ul>
			<p class="mt-3">
				<a href="/{tenantSlug}/settings/meta-ads" class="text-primary hover:underline">
					Reconectează Meta Ads →
				</a>
			</p>
		</CardContent>
	</Card>
</div>
