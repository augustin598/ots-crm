<script lang="ts">
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import SeoLinkUrlCell from '$lib/components/seo-link-url-cell.svelte';

	const tenantSlug = $derived(page.params.tenant as string);

	let filterMonth = $state('');
	let filterStatus = $state('');

	const filterParams = $derived({
		month: filterMonth || undefined,
		status: filterStatus || undefined
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

	function getCheckStatusLabel(link: (typeof seoLinks)[0]) {
		if (!link.lastCheckedAt) return 'Neverificat';
		if (link.lastCheckStatus === 'ok' || link.lastCheckStatus === 'redirect') return 'Accesibil';
		return 'Neaccesibil';
	}

	function getCheckStatusVariant(link: (typeof seoLinks)[0]) {
		if (!link.lastCheckedAt) return 'secondary';
		if (link.lastCheckStatus === 'ok' || link.lastCheckStatus === 'redirect') return 'success';
		return 'destructive';
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
		dofollow: seoLinks.filter((l) => l.linkAttribute === 'dofollow').length,
		accessible: seoLinks.filter(
			(l) => l.lastCheckStatus === 'ok' || l.lastCheckStatus === 'redirect'
		).length,
		platforms: new Set(seoLinks.map((l) => l.pressTrust).filter(Boolean)).size
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
				<p class="text-sm text-muted-foreground">Dofollow</p>
				<p class="text-2xl font-bold">{stats.dofollow}</p>
			</Card>
			<Card class="p-4">
				<p class="text-sm text-muted-foreground">Platforme</p>
				<p class="text-2xl font-bold">{stats.platforms}</p>
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
		<div class="space-y-4">
			{#each seoLinks as link}
				<Card>
					<CardContent class="pt-6">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="flex-1 min-w-0">
								<div class="flex flex-wrap items-center gap-2 mb-2">
									{#if link.articleUrl}
										<img
											src={getFaviconUrl(link.articleUrl)}
											alt={link.pressTrust || 'Logo'}
											class="h-5 w-5 shrink-0 rounded object-contain bg-muted/50"
											loading="lazy"
											onerror={(e) => (e.currentTarget.style.display = 'none')}
										/>
									{/if}
									{#if link.pressTrust}
										<span class="font-medium">{link.pressTrust}</span>
									{/if}
									<Badge variant={getStatusBadge(link.status)}>
										{getStatusLabel(link.status)}
									</Badge>
									<Badge variant={getCheckStatusVariant(link)}>
										{getCheckStatusLabel(link)}
									</Badge>
									<Badge variant={link.linkAttribute === 'dofollow' ? 'default' : 'secondary'}>
										{link.linkAttribute}
									</Badge>
								</div>
								<p class="text-sm text-muted-foreground mb-1">
									Cuvânt cheie: <span class="font-medium text-foreground">{link.keyword}</span>
								</p>
								<div class="flex flex-wrap items-center gap-2">
									<SeoLinkUrlCell url={link.articleUrl} maxChars={55} />
									{#if link.targetUrl}
										<SeoLinkUrlCell url={link.targetUrl} maxChars={40} />
									{/if}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
