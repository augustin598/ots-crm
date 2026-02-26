<script lang="ts">
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { getClientWebsites } from '$lib/remotes/client-websites.remote';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import * as Popover from '$lib/components/ui/popover';
	import { Calendar } from '$lib/components/ui/calendar';
	import {
		Table,
		TableBody,
		TableCell,
		TableFooter,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		Tooltip,
		TooltipContent,
		TooltipProvider,
		TooltipTrigger
	} from '$lib/components/ui/tooltip';
	import SeoLinkUrlCell from '$lib/components/seo-link-url-cell.svelte';
	import HashIcon from '@lucide/svelte/icons/hash';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import KeyIcon from '@lucide/svelte/icons/key';
	import TargetIcon from '@lucide/svelte/icons/target';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import TagIcon from '@lucide/svelte/icons/tag';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';

	const tenantSlug = $derived(page.params.tenant as string);

	let filterMonth = $state('');
	let filterDateOpen = $state(false);
	let filterDateValue = $state<DateValue | undefined>(undefined);
	let filterStatus = $state('');
	let filterCheckStatus = $state('');
	let filterWebsiteId = $state('');
	let filterSearch = $state('');
	let advancedOpen = $state(false);

	const filterParams = $derived({
		month: filterMonth || undefined,
		status: filterStatus || undefined,
		checkStatus: filterCheckStatus || undefined,
		websiteId: filterWebsiteId || undefined,
		search: filterSearch.trim() || undefined
	});

	const advancedActiveCount = $derived([filterCheckStatus].filter(Boolean).length);
	const totalActiveFilters = $derived(
		[filterSearch.trim(), filterStatus, filterMonth, filterCheckStatus, filterWebsiteId].filter(Boolean).length
	);

	// Sync filterMonth → filterDateValue
	$effect(() => {
		if (filterMonth) {
			const [y, m] = filterMonth.split('-').map(Number);
			if (y && m) filterDateValue = new CalendarDate(y, m, 1);
		} else {
			filterDateValue = undefined;
		}
	});

	// Sync filterDateValue → filterMonth
	$effect(() => {
		if (filterDateValue) {
			const mm = `${filterDateValue.year}-${String(filterDateValue.month).padStart(2, '0')}`;
			if (filterMonth !== mm) filterMonth = mm;
		}
	});

	const seoLinksQuery = $derived(getSeoLinks(filterParams));
	const seoLinks = $derived(seoLinksQuery.current || []);
	const loading = $derived(seoLinksQuery.loading);

	const clientId = $derived((page.data as any)?.client?.id as string | undefined);
	const clientName = $derived((page.data as any)?.client?.businessName || (page.data as any)?.client?.name || '');
	const websitesQuery = $derived(clientId ? getClientWebsites(clientId) : null);
	const websites = $derived(websitesQuery?.current || []);
	const websiteMap = $derived(new Map(websites.map((w) => [w.id, w.name || w.url.replace(/^https?:\/\//, '').replace(/^www\./, '')])));
	const defaultWebsite = $derived(websites.find((w) => w.isDefault) ?? websites[0] ?? null);

	function getStatusLabel(status: string) {
		const labels: Record<string, string> = {
			pending: 'În așteptare',
			submitted: 'Trimis',
			published: 'Publicat',
			rejected: 'Refuzat'
		};
		return labels[status] || status;
	}

	function getStatusBadge(status: string) {
		switch (status) {
			case 'published':
				return 'success';
			case 'submitted':
				return 'default';
			case 'rejected':
				return 'destructive';
			case 'pending':
				return 'warning';
			default:
				return 'outline';
		}
	}

	function getLinkTypeLabel(type: string) {
		const labels: Record<string, string> = {
			article: 'Articol',
			'guest-post': 'Guest post',
			'press-release': 'Comunicat de presă',
			directory: 'Director',
			other: 'Altul'
		};
		return labels[type] || type;
	}

	function getCheckStatusBadge(link: (typeof seoLinks)[0]) {
		if (!link.lastCheckedAt) return { variant: 'secondary' as const, label: 'Neverificat' };
		if (link.lastCheckStatus === 'ok' || link.lastCheckStatus === 'redirect')
			return { variant: 'success' as const, label: 'Accesibil' };
		return { variant: 'destructive' as const, label: 'Neaccesibil' };
	}

	function getCheckTooltip(link: (typeof seoLinks)[0]) {
		if (!link.lastCheckedAt) return 'Neverificat';
		const d = link.lastCheckedAt instanceof Date ? link.lastCheckedAt : new Date(link.lastCheckedAt);
		const dateStr = d.toLocaleDateString('ro-RO', { dateStyle: 'short' });
		const code = link.lastCheckHttpCode != null ? ` (${link.lastCheckHttpCode})` : '';
		return `Verificat: ${dateStr}${code}`;
	}

	function formatArticleDate(iso: string | Date): string {
		try {
			const d = typeof iso === 'string' ? new Date(iso) : iso;
			if (isNaN(d.getTime())) return String(iso);
			return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return String(iso);
		}
	}

	function getPublicationDateDisplay(link: (typeof seoLinks)[0]): string | null {
		if (link.articlePublishedAt) return formatArticleDate(link.articlePublishedAt);
		if (link.status === 'published' && link.month) {
			const [y, m] = link.month.split('-').map(Number);
			if (y && m) {
				const d = new Date(y, m - 1, 1);
				return d.toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' });
			}
		}
		return null;
	}

	function getFaviconUrl(articleUrl: string): string {
		try {
			const host = new URL(articleUrl).hostname.replace(/^www\./, '');
			return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
		} catch {
			return '';
		}
	}

	function getPressTrustDisplay(link: { pressTrust: string | null; articleUrl: string }): string {
		if (link.pressTrust?.trim()) return link.pressTrust;
		try {
			const host = new URL(link.articleUrl).hostname.replace(/^www\./, '');
			const base = host.split('.')[0] || '';
			if (base.length <= 3) return base.toUpperCase();
			return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
		} catch {
			return '—';
		}
	}

	const stats = $derived({
		total: seoLinks.length,
		published: seoLinks.filter((l) => l.status === 'published').length,
		dofollow: seoLinks.filter((l) => l.lastCheckDofollow === 'dofollow').length,
		accessible: seoLinks.filter(
			(l) => l.lastCheckStatus === 'ok' || l.lastCheckStatus === 'redirect'
		).length
	});

	const totalByCurrency = $derived.by(() => {
		const sums: Record<string, number> = {};
		for (const link of seoLinks) {
			if (link.price != null && link.price > 0) {
				const curr = (link.currency || 'RON') as Currency;
				sums[curr] = (sums[curr] ?? 0) + link.price;
			}
		}
		return Object.entries(sums).map(([curr, cents]) => ({ currency: curr as Currency, cents }));
	});
</script>

<svelte:head>
	<title>Backlinks - Client Portal</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-4">
		{#if defaultWebsite}
			<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-muted/30 shadow-sm overflow-hidden">
				<img
					src={getFaviconUrl(defaultWebsite.url)}
					alt=""
					class="h-8 w-8 object-contain"
					loading="lazy"
					onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.parentElement as HTMLElement).innerHTML = '<svg xmlns=\'http://www.w3.org/2000/svg\' class=\'h-6 w-6 text-muted-foreground\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'><circle cx=\'12\' cy=\'12\' r=\'10\'/><path d=\'M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z\'/></svg>'; }}
				/>
			</div>
		{/if}
		<div>
			{#if clientName}
				<p class="text-sm font-medium text-muted-foreground">Backlinks</p>
				<h1 class="text-2xl font-bold leading-tight">{clientName}</h1>
			{:else}
				<h1 class="text-3xl font-bold">Backlinks</h1>
			{/if}
			<p class="text-muted-foreground text-sm">Linkurile SEO realizate pentru dvs.</p>
		</div>
	</div>

	{#if !loading && seoLinks.length > 0}
		<div class="grid gap-4 md:grid-cols-4">
			<Card class="p-4">
				<p class="text-sm text-muted-foreground">Total linkuri</p>
				<p class="text-2xl font-bold">{stats.total}</p>
			</Card>
			<Card class="p-4">
				<p class="text-sm text-muted-foreground">Publicate</p>
				<p class="text-2xl font-bold">{stats.published}</p>
			</Card>
			<Card class="p-4">
				<p class="text-sm text-muted-foreground">Accesibil</p>
				<p class="text-2xl font-bold">{stats.accessible}</p>
			</Card>
			<Card class="p-4">
				<p class="text-sm text-muted-foreground">Dofollow</p>
				<p class="text-2xl font-bold">{stats.dofollow}</p>
			</Card>
		</div>
	{/if}

	<div class="rounded-xl border border-border/40 bg-card/50 shadow-sm overflow-hidden">
		<div class="flex flex-wrap items-end gap-3 px-4 pt-4 pb-3">

			<!-- Caută -->
			<div class="space-y-1.5 flex-1 min-w-[200px]">
				<p class="text-xs font-medium text-muted-foreground">Caută</p>
				<div class="relative">
					<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input bind:value={filterSearch} placeholder="keyword, anchor, URL articol..." class="pl-8 h-9 text-sm" />
				</div>
			</div>

			<!-- Status -->
			<div class="space-y-1.5 min-w-[140px]">
				<p class="text-xs font-medium text-muted-foreground">Status</p>
				<Select value={filterStatus || 'all'} type="single" onValueChange={(v) => { filterStatus = v === 'all' ? '' : v || ''; }}>
					<SelectTrigger class="h-9">
						{filterStatus ? getStatusLabel(filterStatus) : 'Toate'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Toate</SelectItem>
						<SelectItem value="pending">În așteptare</SelectItem>
						<SelectItem value="submitted">Trimis</SelectItem>
						<SelectItem value="published">Publicat</SelectItem>
						<SelectItem value="rejected">Refuzat</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<!-- Lună — Calendar popover -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Lună</p>
				<Popover.Root bind:open={filterDateOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="w-[168px] h-9 justify-start text-start font-normal text-sm">
								<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
								{filterMonth
									? (() => { const [y, m] = filterMonth.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' }); })()
									: 'Toate lunile'}
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-auto p-0" align="start">
						<div class="flex flex-col">
							<Calendar type="single" bind:value={filterDateValue} onValueChange={() => (filterDateOpen = false)} locale="ro-RO" captionLayout="dropdown" />
							<Button variant="ghost" class="rounded-t-none border-t text-muted-foreground text-sm" onclick={() => { filterMonth = ''; filterDateValue = undefined; filterDateOpen = false; }}>
								Toate lunile
							</Button>
						</div>
					</Popover.Content>
				</Popover.Root>
			</div>

			<!-- Website (când sunt mai multe) -->
			{#if websites.length > 0}
			<div class="space-y-1.5 min-w-[140px]">
				<p class="text-xs font-medium text-muted-foreground">Website</p>
				<Select val			<Select value={filterWebsiteId || 'all'} type="single" onValueChange={(v) => { filterWebsiteId = v === 'all' ? '' : v || ''; }}>
					<SelectTrigger class="h-9">
						{#if filterWebsiteId}
							{@const selW = websites.find(w => w.id === filterWebsiteId)}
							{#if selW}
								<span class="flex items-center gap-1.5 min-w-0">
									<img src={getFaviconUrl(selW.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => (e.currentTarget.style.display = 'none')} />
									<span class="truncate">{websiteMap.get(filterWebsiteId) || 'Website'}</span>
								</span>
							{:else}
								{websiteMap.get(filterWebsiteId) || 'Website'}
							{/if}
						{:else}
							Toate
						{/if}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Toate</SelectItem>
						{#each websites as w}
							<SelectItem value={w.id}>
								<span class="flex items-center gap-2">
									<img src={getFaviconUrl(w.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => (e.currentTarget.style.display = 'none')} />
									{w.name || w.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
								</span>
							</SelectItem>
						{/each}
					</SelectContent>
			</Select>
			</div>
			{/if}

			<!-- Buton Avansat -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground invisible">.</p>
				<Button variant="outline" class="h-9 gap-2 text-sm" onclick={() => (advancedOpen = !advancedOpen)}>
					Avansat
					{#if advancedActiveCount > 0}
						<Badge variant="secondary" class="h-4 min-w-4 px-1 flex items-center justify-center text-[10px] rounded-full">{advancedActiveCount}</Badge>
					{/if}
					{#if advancedOpen}
						<ChevronUpIcon class="h-3.5 w-3.5 opacity-60" />
					{:else}
						<ChevronDownIcon class="h-3.5 w-3.5 opacity-60" />
					{/if}
				</Button>
			</div>
		</div>

		<!-- Secțiune avansată -->
		{#if advancedOpen}
			<div class="border-t border-border/40 px-4 py-3 flex flex-wrap gap-3">
				<!-- Verificare link -->
				<div class="space-y-1.5 min-w-[180px]">
					<p class="text-xs font-medium text-muted-foreground">Verificare link</p>
					<Select value={filterCheckStatus || 'all'} type="single" onValueChange={(v) => { filterCheckStatus = v === 'all' ? '' : v || ''; }}>
						<SelectTrigger class="h-9">
							{#if filterCheckStatus === 'ok'}Accesibil
							{:else if filterCheckStatus === 'problem'}Neaccesibil
							{:else if filterCheckStatus === 'never'}Neverificat
							{:else}Toate{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">Toate</SelectItem>
							<SelectItem value="ok">Accesibil</SelectItem>
							<SelectItem value="problem">Neaccesibil</SelectItem>
							<SelectItem value="never">Neverificat</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
		{/if}

		<!-- Chips filtre active -->
		{#if totalActiveFilters > 0}
			<div class="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 bg-muted/20">
				{#if filterSearch.trim()}
					<button onclick={() => (filterSearch = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						🔍 "{filterSearch.trim()}" <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterStatus}
					<button onclick={() => (filterStatus = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						{getStatusLabel(filterStatus)} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterMonth}
					<button onclick={() => { filterMonth = ''; filterDateValue = undefined; }} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						📅 {(() => { const [y, m] = filterMonth.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }); })()}
						<XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterCheckStatus}
					<button onclick={() => (filterCheckStatus = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						{#if filterCheckStatus === 'ok'}Accesibil{:else if filterCheckStatus === 'problem'}Neaccesibil{:else}Neverificat{/if} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterWebsiteId}
					<button onclick={() => (filterWebsiteId = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						{websiteMap.get(filterWebsiteId) ?? 'Website'} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else if seoLinks.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">Nu există linkuri SEO.</p>
			</CardContent>
		</Card>
	{:else}
		<div class="rounded-2xl border border-border/40 bg-card/50 shadow-sm backdrop-blur-[2px] overflow-hidden">
			<div class="overflow-x-auto">
				<Table class="text-sm">
					<TableHeader>
						<TableRow class="border-b border-border/50 hover:bg-transparent">
							<TableHead class="w-12 h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<HashIcon class="h-3.5 w-3.5 shrink-0" />
									Nr.
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Număr</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">Numărul de ordine al link-ului în listă.</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<NewspaperIcon class="h-3.5 w-3.5 shrink-0" />
									Trust presă
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<Link2Icon class="h-3.5 w-3.5 shrink-0" />
									Dofollow
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Dofollow vs Nofollow</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													<strong class="text-foreground">Dofollow</strong> — link transmite autoritate către site-ul țintă; Google urmărește link-ul pentru SEO.
												</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed mt-1">
													<strong class="text-foreground">Nofollow</strong> — link nu transmite link equity; Google nu îl urmărește pentru ranking.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<KeyIcon class="h-3.5 w-3.5 shrink-0" />
									Cuvânt cheie
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Cuvânt cheie</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													Cuvântul cheie pentru care a fost optimizat anchor text-ul link-ului. Este extras din textul vizibil al link-ului pe pagină.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TargetIcon class="h-3.5 w-3.5 shrink-0" />
									URL țintă
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">URL țintă</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													URL-ul site-ului tău către care face link articolul. Este pagina de destinație a backlink-ului.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<FileTextIcon class="h-3.5 w-3.5 shrink-0" />
									Link articol
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Link articol</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													URL-ul articolului pe care este publicat link-ul către site-ul tău. Este sursa backlink-ului.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CircleDotIcon class="h-3.5 w-3.5 shrink-0" />
									Status
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Status</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													<strong class="text-foreground">În așteptare</strong> — în lucru. <strong class="text-foreground">Trimis</strong> — articol trimis. <strong class="text-foreground">Publicat</strong> — live pe site. <strong class="text-foreground">Refuzat</strong> — respins. Data este extrasă din articol.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TagIcon class="h-3.5 w-3.5 shrink-0" />
									Tip
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Tip link</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													Articol, Guest post, Comunicat de presă, Director sau Altul — tipul de conținut pe care este publicat link-ul.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CheckCircle2Icon class="h-3.5 w-3.5 shrink-0" />
									Check
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Verificare link</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													<strong class="text-foreground">Accesibil</strong> — link funcțional. <strong class="text-foreground">Neaccesibil</strong> — inaccesibil sau eroare. <strong class="text-foreground">Neverificat</strong> — încă neverificat.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<BanknoteIcon class="h-3.5 w-3.5 shrink-0" />
									Preț
								</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each seoLinks as link, index}
							<TableRow class="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors duration-150">
								<TableCell class="text-muted-foreground tabular-nums text-[13px] px-3 py-3.5 align-middle">
									{index + 1}
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex items-center gap-2.5">
										{#if link.articleUrl}
											<img
												src={getFaviconUrl(link.articleUrl)}
												alt={getPressTrustDisplay(link)}
												class="h-5 w-5 shrink-0 rounded-md object-contain bg-muted/40"
												loading="lazy"
												onerror={(e) => (e.currentTarget.style.display = 'none')}
											/>
										{/if}
										<span class="text-[13px] font-medium text-foreground/90">{getPressTrustDisplay(link)}</span>
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									{#if link.lastCheckDofollow}
										<Badge variant={link.lastCheckDofollow === 'dofollow' ? 'default' : 'secondary'} class="text-[11px] h-5 rounded-full px-2 w-fit font-normal">
											{link.lastCheckDofollow}
										</Badge>
									{:else}
										<span class="text-[12px] text-muted-foreground">Neverificat</span>
									{/if}
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle whitespace-normal">
									<span class="text-[13px] text-foreground/85 line-clamp-2">{link.keyword}</span>
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle">
									{#if link.targetUrl}
										<SeoLinkUrlCell url={link.targetUrl} maxChars={35} />
									{:else}
										<span class="text-muted-foreground/90 text-[13px]">—</span>
									{/if}
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[200px] align-middle">
									<SeoLinkUrlCell url={link.articleUrl} maxChars={45} />
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									{@const pubDate = getPublicationDateDisplay(link)}
									<div class="flex items-center gap-1.5">
										<Badge variant={getStatusBadge(link.status)} class="text-[11px] h-5 rounded-full px-2 font-normal w-fit">
											{getStatusLabel(link.status)}
										</Badge>
										{#if pubDate}
											<Badge variant="secondary" class="text-[11px] h-5 rounded-full px-2 font-normal w-fit text-muted-foreground">
												{pubDate}
											</Badge>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex flex-col gap-0.5">
										{#if link.lastCheckDofollow}
											<Badge variant={link.lastCheckDofollow === 'dofollow' ? 'default' : 'secondary'} class="text-[11px] h-5 rounded-full px-2 w-fit font-normal">
												{link.lastCheckDofollow}
											</Badge>
										{:else}
											<span class="text-[12px] text-muted-foreground">Neverificat</span>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex items-center gap-1.5">
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger>
													<Badge variant={getCheckStatusBadge(link).variant} class="text-[11px] h-5 rounded-full px-2 font-normal">
														{getCheckStatusBadge(link).label}
													</Badge>
												</TooltipTrigger>
												<TooltipContent>
													<p>{getCheckTooltip(link)}</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
										{#if link.lastCheckedAt}
											<Badge variant="secondary" class="text-[11px] h-5 rounded-full px-2 font-normal w-fit text-muted-foreground">
												{formatArticleDate(link.lastCheckedAt)}
											</Badge>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 text-[13px] align-middle">
									{link.price != null
										? formatAmount(link.price, (link.currency || 'RON') as Currency)
										: '—'}
								</TableCell>
							</TableRow>
						{/each}
					</TableBody>
					<TableFooter>
						<TableRow class="border-t-2 border-border/60 bg-muted/30 hover:bg-muted/30 font-medium">
							<TableCell colspan={9} class="pl-5 pr-3 py-3.5 text-right text-[13px] text-muted-foreground">
								Total preț
							</TableCell>
							<TableCell class="px-3 py-3.5 pr-5 text-[13px] font-semibold">
								{#if totalByCurrency.length > 0}
									{totalByCurrency.map(({ currency, cents }) => formatAmount(cents, currency)).join(' · ')}
								{:else}
									—
								{/if}
							</TableCell>
						</TableRow>
					</TableFooter>
				</Table>
			</div>
		</div>
	{/if}
</div>
