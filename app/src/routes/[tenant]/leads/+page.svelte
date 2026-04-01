<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import { getLeadStats, triggerLeadSync, getMetaAdsPages } from '$lib/remotes/leads.remote';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const statsQuery = getLeadStats();
	const stats = $derived(statsQuery.current || []);

	const pagesQuery = getMetaAdsPages();
	const monitoredPages = $derived((pagesQuery.current || []).filter((p: any) => p.isMonitored));

	let syncing = $state(false);

	function getCountForPlatform(platform: string, statusFilter?: string): number {
		return stats
			.filter((s: any) => s.platform === platform && (!statusFilter || s.status === statusFilter))
			.reduce((sum: number, s: any) => sum + s.count, 0);
	}

	function getTotalCount(statusFilter?: string): number {
		return stats
			.filter((s: any) => !statusFilter || s.status === statusFilter)
			.reduce((sum: number, s: any) => sum + s.count, 0);
	}

	async function handleSyncAll() {
		syncing = true;
		try {
			const result = await triggerLeadSync({ platform: 'facebook' });
			toast.success(`Sync finalizat: ${result.imported} noi, ${result.skipped} existente`);
			statsQuery.refresh();
		} catch (e) {
			toast.error('Sync eșuat');
		} finally {
			syncing = false;
		}
	}

	const platforms = $derived([
		{
			label: 'Facebook Ads',
			description: 'Facebook & Instagram Lead Ads',
			href: `/${tenantSlug}/leads/facebook-ads`,
			color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
			icon: IconFacebook,
			platform: 'facebook',
			active: true,
			pages: monitoredPages.map((p: any) => ({ name: p.pageName, id: p.id }))
		},
		{
			label: 'Google Ads',
			description: 'Google Lead Form Extensions',
			href: `/${tenantSlug}/leads/google-ads`,
			color: 'bg-green-500/10 text-green-600 dark:text-green-400',
			icon: IconGoogleAds,
			platform: 'google',
			active: false,
			pages: []
		},
		{
			label: 'TikTok Ads',
			description: 'TikTok Lead Generation',
			href: `/${tenantSlug}/leads/tiktok-ads`,
			color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
			icon: IconTiktok,
			platform: 'tiktok',
			active: false,
			pages: []
		}
	]);
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<ContactIcon class="h-8 w-8" />
				Leads
			</h1>
			<p class="text-muted-foreground">Leaduri din campaniile publicitare</p>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={handleSyncAll} disabled={syncing} variant="outline">
				<RefreshCwIcon class="h-4 w-4 {syncing ? 'animate-spin' : ''}" />
				{syncing ? 'Se sincronizează...' : 'Sync All'}
			</Button>
		</div>
	</div>

	<!-- Stats cards -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each platforms as p (p.label)}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{p.label}</Card.Title>
					<p.icon class="h-8 w-8" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{getCountForPlatform(p.platform)}</div>
					<div class="flex items-center gap-2 mt-1">
						{#if getCountForPlatform(p.platform, 'new') > 0}
							<Badge variant="secondary" class="text-xs">{getCountForPlatform(p.platform, 'new')} noi</Badge>
						{/if}
						{#if !p.active}
							<Badge variant="outline" class="text-xs">Coming soon</Badge>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/each}

		<!-- Total -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">Total</Card.Title>
				<div class="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
					<ContactIcon class="h-4 w-4 text-primary" />
				</div>
			</Card.Header>
			<Card.Content>
				<div class="text-2xl font-bold">{getTotalCount()}</div>
				<div class="flex items-center gap-2 mt-1">
					{#if getTotalCount('new') > 0}
						<Badge variant="secondary" class="text-xs">{getTotalCount('new')} noi</Badge>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Platform quick links (reports-style with page pills) -->
	<div>
		<h2 class="text-lg font-semibold mb-3">Platforme</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			{#each platforms as platform (platform.label)}
				<div class="rounded-lg border bg-card shadow-sm overflow-hidden">
					<a
						href={platform.href}
						class="group flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
					>
						<div class="flex items-center gap-3">
							<platform.icon class="h-7 w-7" />
							<div>
								<p class="font-semibold">{platform.label}</p>
								<p class="text-xs text-muted-foreground">{platform.description}</p>
							</div>
						</div>
						<div class="flex items-center gap-2">
							{#if !platform.active}
								<Badge variant="outline" class="text-xs">Soon</Badge>
							{/if}
							<ChevronRightIcon class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
						</div>
					</a>
					{#if platform.pages.length > 0}
						<div class="border-t px-4 py-3 flex flex-wrap gap-1.5">
							{#each platform.pages as pg (pg.id)}
								<a
									href="{platform.href}?page={pg.id}"
									class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								>
									<span class="relative flex h-2 w-2 shrink-0">
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
										<span class="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
									</span>
									{pg.name}
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
