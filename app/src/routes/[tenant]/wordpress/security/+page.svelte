<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import type { BadgeVariant } from '$lib/components/ui/badge/badge-variants';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';

	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ScanSearchIcon from '@lucide/svelte/icons/scan-search';

	import {
		EVENT_LABELS,
		LEVEL_EMOJI,
		LEVEL_LABELS,
		eventLabel,
		type SentinelLevel
	} from '$lib/logic/wordpress-sentinel-labels';
	import {
		getSecurityOverview,
		getSecurityEvents,
		pullSiteNow
	} from '$lib/remotes/wordpress-security.remote';

	type SiteOverview = Awaited<ReturnType<typeof getSecurityOverview>>[number];
	type EventRow = Awaited<ReturnType<typeof getSecurityEvents>>['rows'][number];

	const tenantSlug = $derived(page.params.tenant ?? '');

	// === Filtre ===
	const filters = $state({
		siteId: 'all',
		level: 'all' as 'all' | SentinelLevel,
		event: 'all',
		period: '7d' as '24h' | '7d',
		q: ''
	});
	// Căutarea se aplică la Enter / ieșirea din câmp, nu la fiecare tastă
	// (altfel fiecare literă ar fi o cerere nouă spre server).
	let qDraft = $state('');

	// Args derivate — valorile „toate”/goale lipsesc din obiect, ca cheia de cache să fie stabilă.
	const eventsArgs = $derived.by(() => {
		const a: {
			siteId?: string;
			level?: SentinelLevel;
			event?: string;
			period: '24h' | '7d';
			q?: string;
		} = { period: filters.period };
		if (filters.siteId !== 'all') a.siteId = filters.siteId;
		if (filters.level !== 'all') a.level = filters.level;
		if (filters.event !== 'all') a.event = filters.event;
		if (filters.q) a.q = filters.q;
		return a;
	});

	// === Reads — declarative ===
	const overview = $derived(await getSecurityOverview());
	const eventsPage = $derived(await getSecurityEvents(eventsArgs));

	// === Paginare „Încă 100” fără $effect ===
	// Rândurile extra țin minte pentru ce filtre au fost aduse; la schimbarea filtrelor
	// cheia nu mai corespunde și `extra` devine automat gol.
	let more = $state.raw<{ key: string; rows: EventRow[]; cursor: string | null }>({
		key: '',
		rows: [],
		cursor: null
	});
	const argsKey = $derived(JSON.stringify(eventsArgs));
	const extra = $derived(more.key === argsKey ? more.rows : []);
	const nextCursor = $derived(more.key === argsKey ? more.cursor : eventsPage.nextCursor);
	// Dedupe defensiv: un rând din paginile extra nu apare de două ori dacă prima pagină s-a mutat.
	const allRows = $derived([
		...eventsPage.rows,
		...extra.filter((r) => !eventsPage.rows.some((b) => b.id === r.id))
	]);
	let loadingMore = $state(false);

	function resetMore() {
		more = { key: '', rows: [], cursor: null };
	}

	async function loadMore() {
		const cursor = nextCursor;
		const key = argsKey;
		if (!cursor || loadingMore) return;
		loadingMore = true;
		try {
			const res = await getSecurityEvents({ ...eventsArgs, cursor });
			// Filtrele s-au schimbat între timp — rezultatul nu mai e relevant.
			if (key !== argsKey) return;
			more = { key, rows: [...extra, ...res.rows], cursor: res.nextCursor };
		} catch (err) {
			toast.error('Nu am putut încărca mai multe evenimente', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			loadingMore = false;
		}
	}

	// === Refresh manual ===
	let isRefreshing = $state(false);
	async function refreshAll() {
		if (isRefreshing) return;
		isRefreshing = true;
		try {
			resetMore();
			await Promise.all([getSecurityOverview().refresh(), getSecurityEvents(eventsArgs).refresh()]);
		} catch (err) {
			toast.error('Reîncărcare eșuată', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			isRefreshing = false;
		}
	}

	// === Citește acum ===
	const BUSY_MESSAGE = 'Citire în curs pentru acest site';
	const pulling = new SvelteSet<string>();

	async function pullNow(site: SiteOverview) {
		if (pulling.has(site.id)) return;
		pulling.add(site.id);
		try {
			const r = await pullSiteNow({ siteId: site.id }).updates(
				getSecurityOverview(),
				getSecurityEvents(eventsArgs)
			);
			// Prima pagină s-a reîmprospătat — paginile extra vechi ar lăsa goluri.
			resetMore();
			const summary = `${site.name}: ${r.inserted} evenimente noi, ${r.findings.length} de semnalat`;
			if (r.status === 'error') {
				toast.error(`${site.name}: ${r.error ?? 'eroare necunoscută'}`);
			} else if (r.status === 'unsupported') {
				toast.warning(`${site.name}: conectorul e mai vechi de 0.9.0`);
			} else if (r.status === 'busy') {
				toast.info(`${site.name}: ${BUSY_MESSAGE}`);
			} else if (r.findings.length > 0) {
				const shown = r.findings.slice(0, 3).map((f) => f.text);
				const rest = r.findings.length - shown.length;
				toast.warning(summary, {
					description: shown.join(' · ') + (rest > 0 ? ` · și încă ${rest}` : '')
				});
			} else {
				toast.success(summary);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// SiteBusyError (citire deja în curs — jobul zilnic sau alt tab) ajunge aici doar ca mesaj.
			if (message.includes(BUSY_MESSAGE)) toast.info(`${site.name}: ${BUSY_MESSAGE}`);
			else toast.error(`${site.name}: ${message}`);
		} finally {
			pulling.delete(site.id);
		}
	}

	// === Detalii eveniment ===
	const expanded = new SvelteSet<string>();
	function toggle(id: string) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	// === Formatare ===
	const shortDateFmt = new Intl.DateTimeFormat('ro-RO', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Bucharest'
	});
	const eventTimeFmt = new Intl.DateTimeFormat('ro-RO', {
		dateStyle: 'short',
		timeStyle: 'medium',
		timeZone: 'Europe/Bucharest'
	});

	function fmtShort(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '—' : shortDateFmt.format(d);
	}
	function fmtEventTime(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? iso : eventTimeFmt.format(d);
	}
	function prettyData(raw: string | null): string {
		if (!raw) return '—';
		try {
			return JSON.stringify(JSON.parse(raw), null, 2);
		} catch {
			return raw;
		}
	}

	function statusBadge(s: SiteOverview): { label: string; variant: BadgeVariant; title?: string } {
		if (s.paused) return { label: 'Pauzat', variant: 'secondary', title: 'Site-ul e pus pe pauză în CRM' };
		// 'busy' nu se persistă, dar dacă apare vreodată e o citire în desfășurare — ca „ok”.
		switch (s.status as SiteOverview['status'] | 'busy') {
			case 'ok':
			case 'busy':
				return { label: `Citit ${fmtShort(s.lastPullAt)}`, variant: 'outline' };
			case 'legacy':
				return {
					label: 'Șterge mu-plugin-ul vechi',
					variant: 'secondary',
					title:
						'Pe site e încă instalat vechiul mu-plugins/ots-sentinel.php. Șterge-l — jurnalul se citește acum prin conector.'
				};
			case 'error':
				return {
					label: s.failures >= 2 ? `Nu răspunde de ${s.failures} zile` : 'Nu răspunde',
					variant: 'destructive',
					title: s.lastError ?? undefined
				};
			case 'unsupported':
				return {
					label: `Conector vechi (v${s.connectorVersion ?? '?'})`,
					variant: 'secondary',
					title: 'Sentinel cere conectorul ≥ 0.9.0'
				};
			default:
				return { label: 'Necitit', variant: 'outline' };
		}
	}

	function cardTint(s: SiteOverview): string {
		const findingCritical = s.recentFindings.some((f) => f.level === 'critical');
		const findingImportant = s.recentFindings.some((f) => f.level === 'important');
		if (s.counts7d.critical > 0 || s.status === 'error' || findingCritical)
			return 'border-red-300 dark:border-red-900';
		if (s.counts7d.important > 0 || s.status === 'legacy' || findingImportant)
			return 'border-amber-300 dark:border-amber-800';
		return '';
	}

	// Card-uri cu lista completă de findings deschisă (implicit se văd primele 3).
	const FINDINGS_VISIBLE = 3;
	const findingsOpen = new SvelteSet<string>();
	function toggleFindings(siteId: string) {
		if (findingsOpen.has(siteId)) findingsOpen.delete(siteId);
		else findingsOpen.add(siteId);
	}

	function levelVariant(level: string): BadgeVariant {
		if (level === 'critical') return 'destructive';
		if (level === 'important') return 'secondary';
		return 'outline';
	}
	function isLevel(level: string): level is SentinelLevel {
		return level in LEVEL_LABELS;
	}

	const periodOptions: { v: '24h' | '7d'; l: string }[] = [
		{ v: '24h', l: '24 h' },
		{ v: '7d', l: '7 z' }
	];
	const levelOptions = Object.keys(LEVEL_LABELS) as SentinelLevel[];
	const eventOptions = Object.entries(EVENT_LABELS).sort((a, b) => a[1].localeCompare(b[1], 'ro'));

	const selectClass =
		'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

	function commitSearch() {
		filters.q = qDraft.trim();
	}
</script>

<svelte:head>
	<title>Securitate WordPress — Sentinel</title>
</svelte:head>

<div class="flex min-w-0 flex-col gap-6">
	<!-- Header -->
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="flex min-w-0 items-start gap-3">
			<Button
				href="/{tenantSlug}/wordpress"
				variant="ghost"
				size="icon"
				aria-label="Înapoi la site-uri"
			>
				<ArrowLeftIcon class="size-4" />
			</Button>
			<div class="min-w-0">
				<h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
					<ShieldIcon class="size-6" aria-hidden="true" />
					Securitate (Sentinel)
				</h1>
				<p class="text-sm text-muted-foreground">
					Jurnalele se citesc zilnic la 09:00; rezumatul ajunge pe Telegram.
				</p>
			</div>
		</div>
		<Button variant="outline" onclick={refreshAll} disabled={isRefreshing}>
			<RefreshCwIcon class="mr-2 size-4 {isRefreshing ? 'animate-spin' : ''}" />
			Reîncarcă
		</Button>
	</div>

	<!-- Secțiunea 1: carduri per site -->
	<section aria-label="Site-uri">
		<svelte:boundary>
			{#snippet pending()}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{#each [0, 1, 2] as i (i)}
						<Skeleton class="h-52 w-full rounded-xl" />
					{/each}
				</div>
			{/snippet}
			{#snippet failed(error, reset)}
				<div
					class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
				>
					<strong>Nu pot încărca site-urile:</strong>
					{error instanceof Error ? error.message : String(error)}
					<Button
						variant="outline"
						size="sm"
						class="ml-2"
						onclick={async () => {
							try {
								await getSecurityOverview().refresh();
							} catch {
								// boundary-ul va afișa din nou eroarea
							}
							reset();
						}}
					>
						Reîncearcă
					</Button>
				</div>
			{/snippet}

			{#if overview.length === 0}
				<Card.Root class="p-8 text-center text-sm text-muted-foreground">
					Niciun site WordPress conectat.
				</Card.Root>
			{:else}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{#each overview as site (site.id)}
						{@const badge = statusBadge(site)}
						{@const isPulling = pulling.has(site.id)}
						<Card.Root class="min-w-0 gap-3 p-4 {cardTint(site)}">
							<div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
								<div class="min-w-0 flex-1 basis-40">
									<div class="truncate font-medium" title={site.name}>{site.name}</div>
									<div class="truncate text-xs text-muted-foreground" title={site.siteUrl}>
										{site.siteUrl}
									</div>
								</div>
								<Badge
									variant={badge.variant}
									title={badge.title ? `${badge.label} — ${badge.title}` : badge.label}
									class="max-w-full text-left whitespace-normal"
								>
									{badge.label}
								</Badge>
							</div>

							<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<div>
									<dt class="text-xs text-muted-foreground">Critice (7 zile)</dt>
									<dd
										class="text-lg font-semibold tabular-nums {site.counts7d.critical > 0
											? 'text-red-600 dark:text-red-400'
											: ''}"
									>
										{site.counts7d.critical}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-muted-foreground">Importante (7 zile)</dt>
									<dd
										class="text-lg font-semibold tabular-nums {site.counts7d.important > 0
											? 'text-amber-700 dark:text-amber-400'
											: ''}"
									>
										{site.counts7d.important}
									</dd>
								</div>
								<div>
									<dt class="text-xs text-muted-foreground">Logări eșuate</dt>
									<dd class="text-lg font-semibold tabular-nums">{site.counts7d.failedLogins}</dd>
								</div>
								<div>
									<dt class="text-xs text-muted-foreground">Logări admin</dt>
									<dd class="text-lg font-semibold tabular-nums">{site.counts7d.adminLogins}</dd>
								</div>
							</dl>

							{#if site.recentFindings.length > 0}
								{@const allOpen = findingsOpen.has(site.id)}
								{@const hidden = site.recentFindings.length - FINDINGS_VISIBLE}
								<div class="flex flex-col gap-1.5">
									<h3 class="text-xs font-medium text-muted-foreground">De semnalat (7 zile)</h3>
									<ul id="sec-findings-{site.id}" class="flex flex-col gap-1.5 text-sm">
										{#each allOpen ? site.recentFindings : site.recentFindings.slice(0, FINDINGS_VISIBLE) as f, i (`${i}:${f.at}`)}
											<li class="flex min-w-0 gap-1.5">
												<span aria-hidden="true" class="shrink-0">{LEVEL_EMOJI[f.level]}</span>
												<span class="sr-only">{LEVEL_LABELS[f.level]}:</span>
												<span class="min-w-0 break-words">
													{f.text}
													<span class="text-xs whitespace-nowrap text-muted-foreground">
														· {fmtShort(f.at)}
													</span>
												</span>
											</li>
										{/each}
									</ul>
									{#if hidden > 0}
										<button
											type="button"
											class="self-start rounded-sm text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
											aria-expanded={allOpen}
											aria-controls="sec-findings-{site.id}"
											onclick={() => toggleFindings(site.id)}
										>
											{allOpen ? 'Arată mai puține' : `+${hidden} de semnalat`}
										</button>
									{/if}
								</div>
							{/if}

							{#if site.lastScan}
								<p class="text-xs text-muted-foreground">
									Uploads: {site.lastScan.scannedFiles} fișiere verificate, {site.lastScan.files} PHP
									{#if site.lastScan.truncated}
										·
										<span
											class="text-amber-700 dark:text-amber-400"
											title="Site-ul are multe fișiere în uploads: scanarea s-a oprit la limita de timp și a verificat doar o parte din ele."
										>
											scanare incompletă (timp depășit)
										</span>
									{/if}
								</p>
							{/if}

							{#if site.pendingCount > 0}
								<p class="text-xs text-muted-foreground">
									{site.pendingCount} de trimis în rezumatul de mâine
								</p>
							{/if}

							{#if site.lastError}
								<p class="truncate text-xs text-red-600 dark:text-red-400" title={site.lastError}>
									{site.lastError}
								</p>
							{/if}

							<div class="mt-auto">
								<Button
									variant="outline"
									size="sm"
									disabled={isPulling || site.status === 'unsupported' || site.paused}
									onclick={() => pullNow(site)}
								>
									{#if isPulling}
										<RefreshCwIcon class="mr-2 size-4 animate-spin" />
										Se citește…
									{:else}
										<ScanSearchIcon class="mr-2 size-4" />
										Citește acum
									{/if}
								</Button>
							</div>
						</Card.Root>
					{/each}
				</div>
			{/if}
		</svelte:boundary>
	</section>

	<!-- Secțiunea 2: evenimente -->
	<Card.Root class="min-w-0 gap-4 p-4">
		<h2 class="text-lg font-semibold">Evenimente</h2>

		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
			<div class="flex flex-col gap-1.5">
				<Label for="sec-filter-site">Site</Label>
				<svelte:boundary>
					{#snippet pending()}
						<select id="sec-filter-site" class={selectClass} disabled>
							<option>Se încarcă…</option>
						</select>
					{/snippet}
					{#snippet failed()}
						<select id="sec-filter-site" class={selectClass} bind:value={filters.siteId}>
							<option value="all">Toate</option>
						</select>
					{/snippet}
					<select id="sec-filter-site" class={selectClass} bind:value={filters.siteId}>
						<option value="all">Toate</option>
						{#each overview as s (s.id)}
							<option value={s.id}>{s.name}</option>
						{/each}
					</select>
				</svelte:boundary>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="sec-filter-level">Nivel</Label>
				<select id="sec-filter-level" class={selectClass} bind:value={filters.level}>
					<option value="all">Toate</option>
					{#each levelOptions as lvl (lvl)}
						<option value={lvl}>{LEVEL_EMOJI[lvl]} {LEVEL_LABELS[lvl]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="sec-filter-event">Eveniment</Label>
				<select id="sec-filter-event" class={selectClass} bind:value={filters.event}>
					<option value="all">Toate</option>
					{#each eventOptions as [key, label] (key)}
						<option value={key}>{label}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<span class="text-sm leading-none font-medium" aria-hidden="true">Perioadă</span>
				<div
					role="group"
					aria-label="Perioadă"
					class="inline-flex h-9 w-full rounded-md border border-input p-0.5"
				>
					{#each periodOptions as opt (opt.v)}
						<button
							type="button"
							aria-pressed={filters.period === opt.v}
							class="flex-1 rounded-[5px] text-sm font-medium transition-colors {filters.period ===
							opt.v
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
							onclick={() => (filters.period = opt.v)}
						>
							{opt.l}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="sec-filter-q">Căutare IP / user</Label>
				<Input
					id="sec-filter-q"
					bind:value={qDraft}
					placeholder="ex. 1.2.3.4 sau admin"
					maxlength={100}
					onchange={commitSearch}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') commitSearch();
					}}
				/>
			</div>
		</div>

		<svelte:boundary>
			{#snippet pending()}
				<div class="flex flex-col gap-2">
					{#each [0, 1, 2, 3, 4] as i (i)}
						<Skeleton class="h-9 w-full" />
					{/each}
				</div>
			{/snippet}
			{#snippet failed(error, reset)}
				<div
					class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
				>
					<strong>Nu pot încărca evenimentele:</strong>
					{error instanceof Error ? error.message : String(error)}
					<Button
						variant="outline"
						size="sm"
						class="ml-2"
						onclick={async () => {
							try {
								await getSecurityEvents(eventsArgs).refresh();
							} catch {
								// boundary-ul va afișa din nou eroarea
							}
							reset();
						}}
					>
						Reîncearcă
					</Button>
				</div>
			{/snippet}

			{#if allRows.length === 0}
				<p class="py-10 text-center text-sm text-muted-foreground">
					Niciun eveniment pentru filtrele alese.
				</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-10"><span class="sr-only">Detalii</span></Table.Head>
							<Table.Head>Ora</Table.Head>
							<Table.Head>Site</Table.Head>
							<Table.Head>Nivel</Table.Head>
							<Table.Head>Eveniment</Table.Head>
							<Table.Head>User</Table.Head>
							<Table.Head>IP</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each allRows as ev (ev.id)}
							{@const open = expanded.has(ev.id)}
							<Table.Row class="cursor-pointer" onclick={() => toggle(ev.id)}>
								<Table.Cell>
									<button
										type="button"
										class="flex size-7 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
										aria-expanded={open}
										aria-controls="sec-ev-{ev.id}"
										aria-label="Detalii eveniment"
										onclick={(e) => {
											e.stopPropagation();
											toggle(ev.id);
										}}
									>
										<ChevronRightIcon
											class="size-4 transition-transform {open ? 'rotate-90' : ''}"
										/>
									</button>
								</Table.Cell>
								<Table.Cell class="tabular-nums">{fmtEventTime(ev.occurredAt)}</Table.Cell>
								<Table.Cell>{ev.siteName}</Table.Cell>
								<Table.Cell>
									<Badge
										variant={levelVariant(ev.level)}
										class={ev.level === 'important' ? 'text-amber-800 dark:text-amber-300' : ''}
									>
										{#if isLevel(ev.level)}
											<span aria-hidden="true">{LEVEL_EMOJI[ev.level]}</span>
											{LEVEL_LABELS[ev.level]}
										{:else}
											{ev.level}
										{/if}
									</Badge>
								</Table.Cell>
								<Table.Cell>{eventLabel(ev.event)}</Table.Cell>
								<Table.Cell class="font-mono text-xs">{ev.username ?? '—'}</Table.Cell>
								<Table.Cell class="font-mono text-xs">{ev.ip ?? '—'}</Table.Cell>
							</Table.Row>
							{#if open}
								<Table.Row id="sec-ev-{ev.id}" class="bg-muted/40 hover:bg-muted/40">
									<Table.Cell colspan={7} class="whitespace-normal">
										<dl class="grid gap-2 text-xs sm:grid-cols-[max-content_1fr] sm:gap-x-4">
											<dt class="font-medium text-muted-foreground">URI</dt>
											<dd class="font-mono break-all">{ev.uri ?? '—'}</dd>
											<dt class="font-medium text-muted-foreground">User-agent</dt>
											<dd class="font-mono break-all">{ev.userAgent ?? '—'}</dd>
											<dt class="font-medium text-muted-foreground">Date</dt>
											<dd>
												<pre class="font-mono text-xs break-all whitespace-pre-wrap">{prettyData(ev.data)}</pre>
											</dd>
										</dl>
									</Table.Cell>
								</Table.Row>
							{/if}
						{/each}
					</Table.Body>
				</Table.Root>

				{#if nextCursor}
					<div class="flex justify-center">
						<Button variant="outline" size="sm" disabled={loadingMore} onclick={loadMore}>
							{#if loadingMore}
								<RefreshCwIcon class="mr-2 size-4 animate-spin" />
							{/if}
							Încă 100
						</Button>
					</div>
				{/if}
			{/if}
		</svelte:boundary>
	</Card.Root>
</div>
