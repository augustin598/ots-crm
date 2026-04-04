<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import BarChart2Icon from '@lucide/svelte/icons/bar-chart-2';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';

	let { data }: { data: any } = $props();

	const tenantSlug = $derived(page.params.tenant as string);

	let since = $state('');
	let until = $state('');

	// Keep in sync when server data updates after navigation
	$effect(() => {
		since = data.since;
		until = data.until;
	});

	function onDateChange() {
		goto(`?since=${since}&until=${until}`, { keepFocus: true, noScroll: true });
	}

	function formatAmount(cents: number, currency: string): string {
		return (cents / 100).toLocaleString('ro-RO', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}) + ' ' + currency;
	}

	function formatTimeAgo(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		const diff = Math.floor((Date.now() - d.getTime()) / 1000);
		if (diff < 60) return 'acum câteva secunde';
		if (diff < 3600) return `acum ${Math.floor(diff / 60)} min`;
		if (diff < 86400) return `acum ${Math.floor(diff / 3600)} ore`;
		return `acum ${Math.floor(diff / 86400)} zile`;
	}

	const platforms = $derived([
		{
			label: 'Meta Ads',
			description: 'Facebook & Instagram Ads',
			href: `/${tenantSlug}/reports/facebook-ads`,
			color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
			accounts: data.metaAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		},
		{
			label: 'Google Ads',
			description: 'Search, Display & YouTube',
			href: `/${tenantSlug}/reports/google-ads`,
			color: 'bg-green-500/10 text-green-600 dark:text-green-400',
			accounts: data.googleAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		},
		{
			label: 'TikTok Ads',
			description: 'TikTok For Business',
			href: `/${tenantSlug}/reports/tiktok-ads`,
			color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
			accounts: data.tiktokAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		}
	]);
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<BarChart2Icon class="h-8 w-8" />
				Rapoarte
			</h1>
			<p class="text-muted-foreground">Performanță advertising</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<DateRangePicker bind:since bind:until onchange={onDateChange} />
			<a
				href="/api/export/spending?format=excel&platform=all&since={since}&until={until}"
				download
				class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
			>
				<DownloadIcon class="h-4 w-4" />
				Export
			</a>
		</div>
	</div>

	<!-- Spend cards -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<!-- Meta Ads -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">Meta Ads</Card.Title>
				<IconFacebook class="h-8 w-8" />
			</Card.Header>
			<Card.Content>
				<div class="text-2xl font-bold">
					{formatAmount(data.adSpend.meta, data.adSpend.currency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Cheltuieli Meta</p>
			</Card.Content>
		</Card.Root>

		<!-- Google Ads -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">Google Ads</Card.Title>
				<IconGoogleAds class="h-8 w-8" />
			</Card.Header>
			<Card.Content>
				<div class="text-2xl font-bold">
					{formatAmount(data.adSpend.google, data.adSpend.currency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Cheltuieli Google</p>
			</Card.Content>
		</Card.Root>

		<!-- TikTok Ads -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">TikTok Ads</Card.Title>
				<IconTiktok class="h-8 w-8" />
			</Card.Header>
			<Card.Content>
				<div class="text-2xl font-bold">
					{formatAmount(data.adSpend.tiktok, data.adSpend.currency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Cheltuieli TikTok</p>
			</Card.Content>
		</Card.Root>

		<!-- Total -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">Total</Card.Title>
				<div class="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
					<TrendingUpIcon class="h-4 w-4 text-primary" />
				</div>
			</Card.Header>
			<Card.Content>
				<div class="text-2xl font-bold">
					{formatAmount(data.adSpend.total, data.adSpend.currency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Toate platformele</p>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Platform quick links -->
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
							<div class="flex h-10 w-10 items-center justify-center rounded-lg {platform.color}">
								<BarChart2Icon class="h-5 w-5" />
							</div>
							<div>
								<p class="font-semibold">{platform.label}</p>
								<p class="text-xs text-muted-foreground">{platform.description}</p>
							</div>
						</div>
						<ChevronRightIcon class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
					</a>
					{#if platform.accounts.length > 0}
						<div class="border-t px-4 py-3 flex flex-wrap gap-1.5">
							{#each platform.accounts as account}
								<a
									href="{platform.href}?account={account.accountId}"
									class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								>
									<span class="relative flex h-2 w-2 shrink-0">
										{#if account.isActive}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
											<span class="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
										{:else}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75"></span>
											<span class="relative inline-flex h-2 w-2 rounded-full bg-orange-500"></span>
										{/if}
									</span>
									{account.accountName}
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Sync errors -->
	{#if data.syncErrors.length > 0}
		<div>
			<h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
				<AlertTriangleIcon class="h-5 w-5 text-destructive" />
				Erori sincronizare recente
			</h2>
			<Card.Root>
				<Card.Content class="p-0">
					<ul class="divide-y">
						{#each data.syncErrors as error}
							<li class="flex items-start gap-3 px-4 py-3">
								<AlertTriangleIcon class="h-4 w-4 text-destructive mt-0.5 shrink-0" />
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" class="text-xs">{error.source}</Badge>
										<span class="text-xs text-muted-foreground">{formatTimeAgo(error.createdAt)}</span>
									</div>
									<p class="text-sm mt-0.5 text-foreground/80 truncate" title={error.message}>{error.message}</p>
								</div>
							</li>
						{/each}
					</ul>
				</Card.Content>
				<Card.Footer class="pt-2 pb-3">
					<a
						href="/{tenantSlug}/settings/logs"
						class="text-xs text-primary hover:underline"
					>
						Vezi toate log-urile →
					</a>
				</Card.Footer>
			</Card.Root>
		</div>
	{/if}
</div>
