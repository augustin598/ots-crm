<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Badge } from '$lib/components/ui/badge';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { toast } from 'svelte-sonner';
	import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import StopCircleIcon from '@lucide/svelte/icons/stop-circle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import {
		previewSeoLinkDiscovery,
		startSeoLinkDiscovery,
		getSeoLinkDiscoveryStatus,
		getSeoLinkDiscoveryResults,
		stopSeoLinkDiscovery,
		bulkSaveDiscoveryResults
	} from '$lib/remotes/seo-links.remote';
	import { SvelteSet } from 'svelte/reactivity';

	interface ClientOption {
		id: string;
		name: string;
	}

	interface Props {
		open: boolean;
		clients: ClientOption[];
		onClose: () => void;
		onSaved?: () => void;
	}

	let { open = $bindable(), clients, onClose, onSaved }: Props = $props();

	type Step = 'input' | 'preview' | 'scan';
	let step = $state<Step>('input');

	// Input state
	let sourceDomain = $state('');
	let selectedClientIds = $state<string[]>([]);
	let extraDomainsText = $state('');
	let clientSearchText = $state('');

	const filteredClients = $derived.by(() => {
		const q = clientSearchText.trim().toLowerCase();
		if (!q) return clients;
		return clients.filter((c) => c.name.toLowerCase().includes(q));
	});

	// Config
	let mode = $state<'recent' | 'date-range' | 'full' | 'search'>('recent');
	let recentSitemapCount = $state(5);
	let dateFrom = $state('');
	let dateTo = $state('');
	let searchKeywordsText = $state('');
	let maxSearchPages = $state(10);
	let maxArticles = $state(2000);
	let maxSitemaps = $state(50);
	let articleConcurrency = $state(3);
	let forceRescanExisting = $state(false);

	// Preview state
	let previewLoading = $state(false);
	let previewError = $state<string | null>(null);
	type PreviewGroup = {
		key: string;
		count: number;
		lastmodMin: string | null;
		lastmodMax: string | null;
		classification: 'ARTICLE' | 'TAXONOMY' | 'MEDIA' | 'UNKNOWN';
		articleScore: number;
		sampleUrls: string[];
	};
	let previewGroups = $state<PreviewGroup[]>([]);
	let previewRoots = $state<string[]>([]);
	const selectedGroupKeys = new SvelteSet<string>();
	let expandedGroupKey = $state<string | null>(null);

	// Scan state
	let jobId = $state<string | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let scanStatus = $state<{
		status: string;
		phase: string;
		totalSitemaps: number;
		processedSitemaps: number;
		totalArticles: number;
		processedArticles: number;
		matchCount: number;
		errorCount: number;
		currentSitemapUrl: string | null;
		error: string | null;
		isRunning: boolean;
	} | null>(null);
	type ResultRow = {
		id: number;
		articleUrl: string;
		articleTitle: string | null;
		articlePublishedAt: string | null;
		pressTrust: string | null;
		targetDomain: string;
		targetUrl: string;
		anchorText: string | null;
		linkAttribute: string | null;
		matchedClientId: string | null;
		alreadyTracked: boolean;
		savedAsSeoLinkId: string | null;
	};
	let results = $state<ResultRow[]>([]);
	let resultCursor = $state(0);
	const selectedResultIds = new SvelteSet<number>();
	let isSaving = $state(false);

	function resetAll() {
		step = 'input';
		sourceDomain = '';
		selectedClientIds = [];
		extraDomainsText = '';
		clientSearchText = '';
		mode = 'recent';
		recentSitemapCount = 5;
		dateFrom = '';
		dateTo = '';
		searchKeywordsText = '';
		maxSearchPages = 10;
		maxArticles = 2000;
		maxSitemaps = 50;
		articleConcurrency = 3;
		forceRescanExisting = false;
		previewLoading = false;
		previewError = null;
		previewGroups = [];
		previewRoots = [];
		selectedGroupKeys.clear();
		expandedGroupKey = null;
		jobId = null;
		scanStatus = null;
		results = [];
		resultCursor = 0;
		selectedResultIds.clear();
		isSaving = false;
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function close() {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		open = false;
		onClose();
		// Delay reset so content doesn't flash on close animation
		setTimeout(resetAll, 200);
	}

	function skipToSearchConfig() {
		if (!sourceDomain.trim()) {
			toast.error('Introdu un domeniu sursă');
			return;
		}
		previewRoots = [];
		previewGroups = [];
		selectedGroupKeys.clear();
		step = 'preview';
	}

	async function runPreview() {
		if (mode === 'search') {
			skipToSearchConfig();
			return;
		}
		if (!sourceDomain.trim()) {
			toast.error('Introdu un domeniu sursă');
			return;
		}
		previewLoading = true;
		previewError = null;
		try {
			const res = await previewSeoLinkDiscovery({ sourceDomain: sourceDomain.trim() });
			previewRoots = res.rootSitemapUrls;
			previewGroups = res.groups.map((g) => ({
				key: g.key,
				count: g.count,
				lastmodMin: g.lastmodMin,
				lastmodMax: g.lastmodMax,
				classification: g.classification,
				articleScore: g.articleScore,
				sampleUrls: g.sampleUrls
			}));
			// Auto-select ARTICLE-classified groups
			selectedGroupKeys.clear();
			for (const g of previewGroups) {
				if (g.classification === 'ARTICLE') selectedGroupKeys.add(g.key);
			}
			step = 'preview';
		} catch (err) {
			previewError = err instanceof Error ? err.message : 'Eroare necunoscută';
			toast.error(previewError);
		} finally {
			previewLoading = false;
		}
	}

	function toggleGroup(key: string) {
		if (selectedGroupKeys.has(key)) selectedGroupKeys.delete(key);
		else selectedGroupKeys.add(key);
	}

	async function startScan() {
		if (selectedClientIds.length === 0 && extraDomainsText.trim() === '') {
			toast.error('Selectează cel puțin un client sau adaugă un domeniu țintă');
			return;
		}
		if (mode === 'search') {
			const keywords = searchKeywordsText
				.split(/[\n,]/)
				.map((s) => s.trim())
				.filter(Boolean);
			if (keywords.length === 0) {
				toast.error('Introdu cel puțin un keyword de căutare');
				return;
			}
		} else if (selectedGroupKeys.size === 0 && previewGroups.length > 0) {
			toast.error('Selectează cel puțin un grup de sitemap-uri');
			return;
		}
		try {
			const extras = extraDomainsText
				.split(/[\s,]+/)
				.map((s) => s.trim())
				.filter(Boolean);
			const keywords = searchKeywordsText
				.split(/[\n,]/)
				.map((s) => s.trim())
				.filter(Boolean);
			const res = await startSeoLinkDiscovery({
				sourceDomain: sourceDomain.trim(),
				config: {
					mode,
					recentSitemapCount: mode === 'recent' ? recentSitemapCount : undefined,
					dateFrom: mode === 'date-range' ? dateFrom : undefined,
					dateTo: mode === 'date-range' ? dateTo : undefined,
					searchKeywords: mode === 'search' ? keywords : undefined,
					maxSearchPages: mode === 'search' ? maxSearchPages : undefined,
					maxArticles,
					maxSitemaps,
					articleConcurrency,
					clientIds: selectedClientIds,
					extraTargetDomains: extras,
					selectedGroupKeys: Array.from(selectedGroupKeys),
					forceRescanExisting
				}
			});
			jobId = res.jobId;
			results = [];
			resultCursor = 0;
			selectedResultIds.clear();
			step = 'scan';
			pollOnce();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la pornire');
		}
	}

	async function pollOnce() {
		if (!jobId) return;
		try {
			const [status, resultsBatch] = await Promise.all([
				getSeoLinkDiscoveryStatus({ jobId }),
				getSeoLinkDiscoveryResults({ jobId, afterId: resultCursor, limit: 200 })
			]);
			scanStatus = status;
			if (resultsBatch.results.length > 0) {
				results = [...results, ...(resultsBatch.results as ResultRow[])];
				resultCursor = resultsBatch.nextCursor;
			}
			if (status.isRunning || status.status === 'running') {
				pollTimer = setTimeout(pollOnce, 2500);
			}
		} catch (err) {
			console.error('poll error', err);
			pollTimer = setTimeout(pollOnce, 5000);
		}
	}

	async function stopScan() {
		if (!jobId) return;
		try {
			await stopSeoLinkDiscovery({ jobId });
			toast.info('Scan oprit');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la oprire');
		}
	}

	function toggleResult(id: number) {
		if (selectedResultIds.has(id)) selectedResultIds.delete(id);
		else selectedResultIds.add(id);
	}

	function selectAllResults() {
		selectedResultIds.clear();
		for (const r of results) {
			if (!r.alreadyTracked && !r.savedAsSeoLinkId && r.matchedClientId) {
				selectedResultIds.add(r.id);
			}
		}
	}

	function clearResultSelection() {
		selectedResultIds.clear();
	}

	async function saveSelected() {
		if (!jobId || selectedResultIds.size === 0) {
			toast.error('Selectează cel puțin un rezultat');
			return;
		}
		isSaving = true;
		try {
			const res = await bulkSaveDiscoveryResults({
				jobId,
				resultIds: Array.from(selectedResultIds)
			});
			toast.success(`Salvate: ${res.created} linkuri (skip: ${res.skipped})`);
			// Mark saved rows in local state
			const saved = new Set(selectedResultIds);
			results = results.map((r) =>
				saved.has(r.id) ? { ...r, savedAsSeoLinkId: 'saved', alreadyTracked: true } : r
			);
			selectedResultIds.clear();
			onSaved?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la salvare');
		} finally {
			isSaving = false;
		}
	}

	const scanProgressPct = $derived(
		scanStatus && scanStatus.totalArticles > 0
			? Math.round((scanStatus.processedArticles / scanStatus.totalArticles) * 100)
			: 0
	);
	const sitemapProgressPct = $derived(
		scanStatus && scanStatus.totalSitemaps > 0
			? Math.round((scanStatus.processedSitemaps / scanStatus.totalSitemaps) * 100)
			: 0
	);

	function classBadgeVariant(c: string) {
		if (c === 'ARTICLE') return 'default' as const;
		if (c === 'TAXONOMY') return 'secondary' as const;
		if (c === 'MEDIA') return 'destructive' as const;
		return 'outline' as const;
	}

	function clientName(id: string | null): string {
		if (!id) return '—';
		return clients.find((c) => c.id === id)?.name ?? id;
	}
</script>

<Dialog
	bind:open
	onOpenChange={(o) => {
		if (!o) close();
	}}
>
	<DialogContent class="w-[95vw] sm:max-w-[1100px] max-h-[90vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<ScanSearchIcon class="h-5 w-5" />
				Descoperă backlink-uri pe un site sursă
			</DialogTitle>
			<DialogDescription>
				Scanează sitemap-ul unui site pentru a găsi articole care conțin linkuri spre
				domeniile clienților tăi.
			</DialogDescription>
		</DialogHeader>

		{#if step === 'input'}
			<div class="space-y-4 py-2">
				<div class="space-y-1.5">
					<Label for="discovery-source">Domeniu sursă</Label>
					<Input
						id="discovery-source"
						bind:value={sourceDomain}
						placeholder="ex: bzi.ro"
						onkeydown={(e) => {
							if (e.key === 'Enter') runPreview();
						}}
					/>
					<p class="text-xs text-muted-foreground">
						Site-ul pe care vrem să căutăm articole cu backlink-uri (ex: bzi.ro, bzv.ro, ziare.com)
					</p>
				</div>

				<div class="space-y-1.5">
					<Label>Metodă de descoperire</Label>
					<Select type="single" bind:value={mode}>
						<SelectTrigger class="w-full">
							{#if mode === 'recent'}
								Sitemap — Recent
							{:else if mode === 'date-range'}
								Sitemap — Interval date
							{:else if mode === 'full'}
								Sitemap — Full scan
							{:else}
								Căutare pe site (keyword)
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="recent">Sitemap — Recent (ultimele N sitemap-uri)</SelectItem>
							<SelectItem value="date-range">Sitemap — Interval date</SelectItem>
							<SelectItem value="full">Sitemap — Full scan (tot arhiva)</SelectItem>
							<SelectItem value="search">Căutare pe site (ex: bzv.ro/?s=heylux)</SelectItem>
						</SelectContent>
					</Select>
					<p class="text-xs text-muted-foreground">
						{#if mode === 'search'}
							Folosește căutarea nativă a site-ului (WordPress). Mai rapid dacă știi keyword-ul brandului.
						{:else}
							Crawl sitemap-ul site-ului și clasifică dinamic grupurile de URL-uri.
						{/if}
					</p>
				</div>

				{#if previewError}
					<div class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
						{previewError}
					</div>
				{/if}
			</div>

			<DialogFooter>
				<Button variant="outline" onclick={close}>Anulare</Button>
				<Button onclick={runPreview} disabled={previewLoading || !sourceDomain.trim()}>
					{#if previewLoading}
						<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
						Analizez sitemap...
					{:else}
						<ChevronRightIcon class="mr-2 h-4 w-4" />
						{mode === 'search' ? 'Continuă' : 'Analizează sitemap'}
					{/if}
				</Button>
			</DialogFooter>
		{:else if step === 'preview'}
			<div class="space-y-4 py-2">
				{#if mode !== 'search'}
					<!-- Root sitemap urls -->
					<div class="rounded-md bg-muted/40 px-3 py-2 text-xs">
						<span class="font-medium">Sitemap-uri detectate:</span>
						<div class="mt-1 space-y-0.5 text-muted-foreground">
							{#each previewRoots as r (r)}
								<div class="truncate">{r}</div>
							{/each}
						</div>
					</div>
				{:else}
					<!-- Search mode banner -->
					<div class="rounded-md bg-muted/40 px-3 py-2 text-xs">
						<span class="font-medium">Modul Căutare:</span>
						<span class="text-muted-foreground">
							se vor accesa URL-uri de forma <code class="text-foreground">https://{sourceDomain}/?s={'{keyword}'}</code>
							și paginare <code class="text-foreground">/page/N/?s={'{keyword}'}</code>
						</span>
					</div>
				{/if}

				{#if mode !== 'search'}
				<!-- Groups -->
				<div class="space-y-1.5">
					<Label>Grupuri sitemap ({previewGroups.length})</Label>
					<p class="text-xs text-muted-foreground">
						Bifate automat cele clasificate ca articole. Click pe un rând pentru sample URL-uri.
					</p>
					<div class="max-h-64 overflow-y-auto rounded-md border divide-y">
						{#each previewGroups as g (g.key)}
							<div class="hover:bg-muted/30">
								<div class="flex items-center gap-2 px-3 py-2">
									<Checkbox
										checked={selectedGroupKeys.has(g.key)}
										onCheckedChange={() => toggleGroup(g.key)}
									/>
									<button
										type="button"
										class="flex-1 text-left flex items-center gap-2 min-w-0"
										onclick={() => (expandedGroupKey = expandedGroupKey === g.key ? null : g.key)}
									>
										<span class="font-mono text-xs truncate flex-1">{g.key}</span>
										<Badge variant={classBadgeVariant(g.classification)} class="text-xs">
											{g.classification}
										</Badge>
										<span class="text-xs text-muted-foreground w-16 text-right">
											{g.count} fișiere
										</span>
										<span class="text-xs text-muted-foreground w-14 text-right">
											score {g.articleScore}
										</span>
									</button>
								</div>
								{#if expandedGroupKey === g.key}
									<div class="px-9 pb-2 space-y-0.5 text-xs text-muted-foreground">
										<div>Interval lastmod: {g.lastmodMin ?? '—'} → {g.lastmodMax ?? '—'}</div>
										<div class="font-medium text-foreground mt-1">Sample URLs:</div>
										{#each g.sampleUrls as u (u)}
											<div class="truncate">{u}</div>
										{/each}
										{#if g.sampleUrls.length === 0}
											<div class="italic">(nu s-au putut citi URL-uri sample)</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
						{#if previewGroups.length === 0}
							<div class="px-3 py-4 text-center text-sm text-muted-foreground">
								Niciun grup detectat. Sitemap-ul pare să fie un urlset direct.
							</div>
						{/if}
					</div>
				</div>
				{/if}

				{#if mode === 'search'}
					<div class="space-y-1.5">
						<Label for="search-keywords">Keywords de căutat</Label>
						<Textarea
							id="search-keywords"
							bind:value={searchKeywordsText}
							placeholder="heylux&#10;lucky studio&#10;glemis"
							rows={4}
						/>
						<p class="text-xs text-muted-foreground">
							Un keyword pe linie (sau separate prin virgulă). Ideal: numele brandului clientului.
						</p>
					</div>
					<div class="space-y-1.5 sm:max-w-xs">
						<Label for="max-search-pages">Max pagini per keyword</Label>
						<Input id="max-search-pages" type="number" min="1" max="50" bind:value={maxSearchPages} />
					</div>
				{/if}

				<!-- Targets -->
				<div class="space-y-1.5">
					<div class="flex items-center gap-2">
						<Label class="flex-1">Clienți țintă</Label>
						{#if selectedClientIds.length > 0}
							<span class="text-xs text-muted-foreground">
								{selectedClientIds.length} selectat{selectedClientIds.length === 1 ? '' : 'i'}
							</span>
							<button
								type="button"
								class="text-xs text-primary hover:underline"
								onclick={() => (selectedClientIds = [])}
							>
								Resetează
							</button>
						{/if}
					</div>
					<div class="relative">
						<SearchIcon class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							class="pl-8"
							placeholder="Caută client după nume..."
							bind:value={clientSearchText}
						/>
					</div>
					<div class="max-h-48 overflow-y-auto rounded-md border divide-y">
						{#if selectedClientIds.length > 0}
							{#each clients.filter((c) => selectedClientIds.includes(c.id)) as c (c.id)}
								<label class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30 bg-primary/5">
									<Checkbox
										checked={true}
										onCheckedChange={() => {
											selectedClientIds = selectedClientIds.filter((x) => x !== c.id);
										}}
									/>
									<span class="text-sm font-medium">{c.name}</span>
								</label>
							{/each}
						{/if}
						{#each filteredClients.filter((c) => !selectedClientIds.includes(c.id)) as c (c.id)}
							<label class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30">
								<Checkbox
									checked={false}
									onCheckedChange={(v) => {
										if (v) selectedClientIds = [...selectedClientIds, c.id];
									}}
								/>
								<span class="text-sm">{c.name}</span>
							</label>
						{/each}
						{#if filteredClients.filter((c) => !selectedClientIds.includes(c.id)).length === 0 && clientSearchText.trim()}
							<div class="px-3 py-3 text-center text-xs text-muted-foreground">
								Niciun client potrivit pentru "{clientSearchText}"
							</div>
						{/if}
					</div>
				</div>

				<div class="space-y-1.5">
					<Label for="extra-domains">Domenii adiționale (opțional)</Label>
					<Textarea
						id="extra-domains"
						bind:value={extraDomainsText}
						placeholder="heylux.ro, luckystudio.ro"
						rows={2}
					/>
					<p class="text-xs text-muted-foreground">
						Separate prin virgulă sau spațiu. Se adaugă peste domeniile clienților.
					</p>
				</div>

				{#if mode !== 'search'}
					<!-- Sitemap mode options (only for sitemap modes) -->
					<div class="space-y-3">
						{#if mode === 'recent'}
							<div class="space-y-1.5 sm:max-w-xs">
								<Label for="recent-count">Nr. sitemap-uri recente</Label>
								<Input id="recent-count" type="number" min="1" max="50" bind:value={recentSitemapCount} />
							</div>
						{:else if mode === 'date-range'}
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:max-w-md">
								<div class="space-y-1.5">
									<Label for="date-from">De la</Label>
									<Input id="date-from" type="date" bind:value={dateFrom} />
								</div>
								<div class="space-y-1.5">
									<Label for="date-to">Până la</Label>
									<Input id="date-to" type="date" bind:value={dateTo} />
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<details class="rounded-md border px-3 py-2 text-sm">
					<summary class="cursor-pointer font-medium">Opțiuni avansate</summary>
					<div class="mt-3 grid grid-cols-3 gap-3">
						<div class="space-y-1.5">
							<Label for="max-articles">Max articole</Label>
							<Input id="max-articles" type="number" min="10" max="10000" bind:value={maxArticles} />
						</div>
						<div class="space-y-1.5">
							<Label for="max-sitemaps">Max sitemap-uri</Label>
							<Input id="max-sitemaps" type="number" min="1" max="300" bind:value={maxSitemaps} />
						</div>
						<div class="space-y-1.5">
							<Label for="concurrency">Concurență</Label>
							<Input id="concurrency" type="number" min="1" max="5" bind:value={articleConcurrency} />
						</div>
					</div>
					<label class="mt-3 flex items-center gap-2 cursor-pointer">
						<Checkbox bind:checked={forceRescanExisting} />
						<span class="text-sm">Forțează re-scan pentru URL-uri deja tracked</span>
					</label>
				</details>

				{#if mode === 'full'}
					<div class="rounded-md border border-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm">
						<strong>Atenție:</strong> Full scan poate dura ore pe site-uri mari. Se aplică hard-cap la
						{maxArticles} articole.
					</div>
				{/if}
			</div>

			<DialogFooter>
				<Button variant="outline" onclick={() => (step = 'input')}>Înapoi</Button>
				<Button onclick={startScan}>
					<ScanSearchIcon class="mr-2 h-4 w-4" />
					Pornește scanarea
				</Button>
			</DialogFooter>
		{:else if step === 'scan'}
			<div class="space-y-4 py-2">
				{#if scanStatus}
					<!-- Progress bars -->
					<div class="space-y-3 rounded-md border p-3">
						<div>
							<div class="flex justify-between text-xs mb-1">
								<span class="font-medium">Sitemap-uri</span>
								<span class="text-muted-foreground">
									{scanStatus.processedSitemaps} / {scanStatus.totalSitemaps}
								</span>
							</div>
							<div class="h-2 w-full rounded-full bg-muted overflow-hidden">
								<div
									class="h-2 rounded-full bg-primary transition-all"
									style="width: {sitemapProgressPct}%"
								></div>
							</div>
							{#if scanStatus.currentSitemapUrl}
								<p class="text-xs text-muted-foreground mt-1 truncate">
									{scanStatus.currentSitemapUrl}
								</p>
							{/if}
						</div>
						<div>
							<div class="flex justify-between text-xs mb-1">
								<span class="font-medium">Articole scanate</span>
								<span class="text-muted-foreground">
									{scanStatus.processedArticles} / {scanStatus.totalArticles}
								</span>
							</div>
							<div class="h-2 w-full rounded-full bg-muted overflow-hidden">
								<div
									class="h-2 rounded-full bg-primary transition-all"
									style="width: {scanProgressPct}%"
								></div>
							</div>
						</div>
						<div class="flex gap-4 text-xs">
							<span class="flex items-center gap-1">
								<CheckCircle2Icon class="h-3.5 w-3.5 text-green-600" />
								{scanStatus.matchCount} match-uri
							</span>
							<span class="text-muted-foreground">{scanStatus.errorCount} erori</span>
							<Badge variant="outline" class="ml-auto">{scanStatus.status}</Badge>
						</div>
					</div>

					{#if scanStatus.error}
						<div class="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{scanStatus.error}
						</div>
					{/if}
				{/if}

				<!-- Results table -->
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<Label>Rezultate ({results.length})</Label>
						<div class="ml-auto flex gap-2">
							<Button variant="outline" size="sm" onclick={selectAllResults}>Select all</Button>
							<Button variant="outline" size="sm" onclick={clearResultSelection}>Clear</Button>
						</div>
					</div>
					<div class="max-h-72 overflow-y-auto rounded-md border">
						<table class="w-full text-xs">
							<thead class="sticky top-0 bg-muted/80 backdrop-blur">
								<tr>
									<th class="w-8 px-2 py-2"></th>
									<th class="px-2 py-2 text-left font-medium">Articol</th>
									<th class="px-2 py-2 text-left font-medium">Client</th>
									<th class="px-2 py-2 text-left font-medium">Anchor</th>
									<th class="px-2 py-2 text-left font-medium">Atr.</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each results as r (r.id)}
									<tr class:bg-muted={r.alreadyTracked || r.savedAsSeoLinkId}>
										<td class="px-2 py-1.5">
											<Checkbox
												checked={selectedResultIds.has(r.id)}
												disabled={r.alreadyTracked || !!r.savedAsSeoLinkId || !r.matchedClientId}
												onCheckedChange={() => toggleResult(r.id)}
											/>
										</td>
										<td class="px-2 py-1.5 max-w-[280px]">
											<a
												href={r.articleUrl}
												target="_blank"
												rel="noopener noreferrer"
												class="text-primary hover:underline flex items-center gap-1 truncate"
												title={r.articleUrl}
											>
												<span class="truncate">{r.articleTitle || r.articleUrl}</span>
												<ExternalLinkIcon class="h-3 w-3 shrink-0" />
											</a>
											{#if r.articlePublishedAt}
												<div class="text-muted-foreground">
													{r.articlePublishedAt.slice(0, 10)}
												</div>
											{/if}
										</td>
										<td class="px-2 py-1.5 max-w-[120px] truncate">
											{clientName(r.matchedClientId)}
										</td>
										<td class="px-2 py-1.5 max-w-[140px] truncate" title={r.anchorText ?? ''}>
											{r.anchorText || '—'}
										</td>
										<td class="px-2 py-1.5">
											{#if r.alreadyTracked && !r.savedAsSeoLinkId}
												<Badge variant="secondary" class="text-xs">tracked</Badge>
											{:else if r.savedAsSeoLinkId}
												<Badge class="text-xs">saved</Badge>
											{:else}
												<Badge variant="outline" class="text-xs">{r.linkAttribute ?? '?'}</Badge>
											{/if}
										</td>
									</tr>
								{/each}
								{#if results.length === 0}
									<tr>
										<td colspan="5" class="px-3 py-6 text-center text-muted-foreground">
											{#if scanStatus?.isRunning}
												Scanare în curs...
											{:else}
												Niciun match
											{/if}
										</td>
									</tr>
								{/if}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<DialogFooter class="gap-2">
				{#if scanStatus?.isRunning}
					<Button variant="outline" onclick={stopScan}>
						<StopCircleIcon class="mr-2 h-4 w-4" />
						Oprește
					</Button>
				{:else}
					<Button variant="outline" onclick={close}>Închide</Button>
				{/if}
				<Button
					onclick={saveSelected}
					disabled={selectedResultIds.size === 0 || isSaving}
				>
					{#if isSaving}
						<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
					{/if}
					Salvează selecția ({selectedResultIds.size})
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
