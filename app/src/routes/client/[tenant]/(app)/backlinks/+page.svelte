<script lang="ts">
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
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

	const tenantSlug = $derived(page.params.tenant as string);

	let filterMonth = $state('');
	let filterStatus = $state('');
	let filterCheckStatus = $state('');

	const filterParams = $derived({
		month: filterMonth || undefined,
		status: filterStatus || undefined,
		checkStatus: filterCheckStatus || undefined
	});

	const seoLinksQuery = getSeoLinks(filterParams);
	const seoLinks = $derived(seoLinksQuery.current || []);
	const loading = $derived(seoLinksQuery.loading);

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

	function getFaviconUrl(articleUrl: string): string {
		try {
			const host = new URL(articleUrl).hostname.replace(/^www\./, '');
			return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
		} catch {
			return '';
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
</script>

<svelte:head>
	<title>Backlinks - Client Portal</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Backlinks</h1>
		<p class="text-muted-foreground">Linkurile SEO realizate pentru dvs.</p>
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

	<div class="flex flex-wrap items-center gap-4">
		<div>
			<Label class="text-xs text-muted-foreground">Lună</Label>
			<Input
				type="month"
				bind:value={filterMonth}
				placeholder="Toate lunile"
				class="max-w-[180px]"
			/>
		</div>
		<div class="min-w-[160px]">
			<Label class="text-xs text-muted-foreground">Status</Label>
			<Select
				value={filterStatus || 'all'}
				type="single"
				onValueChange={(v: string | undefined) => {
					filterStatus = v === 'all' ? '' : v || '';
				}}
			>
				<SelectTrigger>
					{#if filterStatus}
						{getStatusLabel(filterStatus)}
					{:else}
						Toate
					{/if}
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
		<div class="min-w-[160px]">
			<Label class="text-xs text-muted-foreground">Verificare</Label>
			<Select
				value={filterCheckStatus || 'all'}
				type="single"
				onValueChange={(v: string | undefined) => {
					filterCheckStatus = v === 'all' ? '' : v || '';
				}}
			>
				<SelectTrigger>
					{#if filterCheckStatus === 'ok'}
						Accesibil
					{:else if filterCheckStatus === 'problem'}
						Neaccesibil
					{:else if filterCheckStatus === 'never'}
						Neverificat
					{:else}
						Toate
					{/if}
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
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<KeyIcon class="h-3.5 w-3.5 shrink-0" />
									Cuvânt cheie
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<FileTextIcon class="h-3.5 w-3.5 shrink-0" />
									Link articol
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CircleDotIcon class="h-3.5 w-3.5 shrink-0" />
									Status
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TagIcon class="h-3.5 w-3.5 shrink-0" />
									Tip
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CheckCircle2Icon class="h-3.5 w-3.5 shrink-0" />
									Check
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TargetIcon class="h-3.5 w-3.5 shrink-0" />
									URL țintă
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
												alt={link.pressTrust || 'Logo'}
												class="h-5 w-5 shrink-0 rounded-md object-contain bg-muted/40"
												loading="lazy"
												onerror={(e) => (e.currentTarget.style.display = 'none')}
											/>
										{/if}
										<span class="text-[13px] font-medium text-foreground/90">{link.pressTrust || '—'}</span>
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
								<TableCell class="px-3 py-3.5 max-w-[200px] align-middle">
									<SeoLinkUrlCell url={link.articleUrl} maxChars={45} />
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<Badge variant={getStatusBadge(link.status)} class="text-[11px] h-5 rounded-full px-2 font-normal">
										{getStatusLabel(link.status)}
									</Badge>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex flex-col gap-0.5">
										{#if link.linkType}
											<span class="text-[13px] text-foreground/85">{getLinkTypeLabel(link.linkType)}</span>
										{/if}
										{#if link.lastCheckDofollow}
											<Badge variant={link.lastCheckDofollow === 'dofollow' ? 'default' : 'secondary'} class="text-[11px] h-5 rounded-full px-2 w-fit font-normal">
												{link.lastCheckDofollow}
											</Badge>
										{:else if !link.linkType}
											<span class="text-[13px] text-muted-foreground">—</span>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
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
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle">
									{#if link.targetUrl}
										<SeoLinkUrlCell url={link.targetUrl} maxChars={35} />
									{:else}
										<span class="text-muted-foreground/90 text-[13px]">—</span>
									{/if}
								</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			</div>
		</div>
	{/if}
</div>
