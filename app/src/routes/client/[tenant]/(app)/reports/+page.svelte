<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import BarChart2Icon from '@lucide/svelte/icons/bar-chart-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';

	let { data }: { data: any } = $props();

	const tenantSlug = $derived(page.params.tenant as string);

	let since = $state(data.since as string);
	let until = $state(data.until as string);

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

	const activeCurrencies = $derived(new Set([
		...(data.adSpend.meta > 0 ? [data.adSpend.metaCurrency] : []),
		...(data.adSpend.google > 0 ? [data.adSpend.googleCurrency] : []),
		...(data.adSpend.tiktok > 0 ? [data.adSpend.tiktokCurrency] : [])
	]));
	const sameCurrency = $derived(activeCurrencies.size <= 1);
	const mainCurrency = $derived(activeCurrencies.values().next().value ?? 'RON');

	const platforms = $derived([
		{
			label: 'Meta Ads',
			description: 'Facebook & Instagram Ads',
			href: `/client/${tenantSlug}/reports/facebook-ads`,
			color: 'bg-blue-500/10',
			icon: 'meta' as const
		},
		{
			label: 'Google Ads',
			description: 'Search, Display & YouTube',
			href: `/client/${tenantSlug}/reports/google-ads`,
			color: 'bg-green-500/10',
			icon: 'google' as const
		},
		{
			label: 'TikTok Ads',
			description: 'TikTok For Business',
			href: `/client/${tenantSlug}/reports/tiktok-ads`,
			color: 'bg-pink-500/10',
			icon: 'tiktok' as const
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
		<DateRangePicker bind:since bind:until onchange={onDateChange} />
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
					{formatAmount(data.adSpend.meta, data.adSpend.metaCurrency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Cheltuieli Meta</p>
				{#if data.adSpend.metaAccounts.length > 1}
					<div class="mt-3 border-t pt-2 space-y-1">
						{#each data.adSpend.metaAccounts as account}
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<span class="truncate mr-2">{account.accountName}</span>
								<span class="font-medium text-foreground whitespace-nowrap">{formatAmount(account.spendCents, account.currency)}</span>
							</div>
						{/each}
					</div>
				{/if}
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
					{formatAmount(data.adSpend.google, data.adSpend.googleCurrency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Cheltuieli Google</p>
				{#if data.adSpend.googleAccounts.length > 1}
					<div class="mt-3 border-t pt-2 space-y-1">
						{#each data.adSpend.googleAccounts as account}
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<span class="truncate mr-2">{account.accountName}</span>
								<span class="font-medium text-foreground whitespace-nowrap">{formatAmount(account.spendCents, account.currency)}</span>
							</div>
						{/each}
					</div>
				{/if}
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
					{formatAmount(data.adSpend.tiktok, data.adSpend.tiktokCurrency)}
				</div>
				<p class="text-xs text-muted-foreground mt-1">Cheltuieli TikTok</p>
				{#if data.adSpend.tiktokAccounts.length > 1}
					<div class="mt-3 border-t pt-2 space-y-1">
						{#each data.adSpend.tiktokAccounts as account}
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<span class="truncate mr-2">{account.accountName}</span>
								<span class="font-medium text-foreground whitespace-nowrap">{formatAmount(account.spendCents, account.currency)}</span>
							</div>
						{/each}
					</div>
				{/if}
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
				{#if sameCurrency}
					<div class="text-2xl font-bold">
						{formatAmount(data.adSpend.total, mainCurrency)}
					</div>
					<p class="text-xs text-muted-foreground mt-1">Toate platformele</p>
				{:else}
					<div class="space-y-1">
						{#if data.adSpend.meta > 0}
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Meta</span>
								<span class="font-semibold">{formatAmount(data.adSpend.meta, data.adSpend.metaCurrency)}</span>
							</div>
						{/if}
						{#if data.adSpend.google > 0}
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Google</span>
								<span class="font-semibold">{formatAmount(data.adSpend.google, data.adSpend.googleCurrency)}</span>
							</div>
						{/if}
						{#if data.adSpend.tiktok > 0}
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">TikTok</span>
								<span class="font-semibold">{formatAmount(data.adSpend.tiktok, data.adSpend.tiktokCurrency)}</span>
							</div>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground mt-1">Monede diferite</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Platform quick links -->
	<div>
		<h2 class="text-lg font-semibold mb-3">Platforme</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			{#each platforms as platform (platform.label)}
				<a
					href={platform.href}
					class="group flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/50"
				>
					<div class="flex items-center gap-3">
						{#if platform.icon === 'meta'}
							<IconFacebook class="h-7 w-7" />
						{:else if platform.icon === 'google'}
							<IconGoogleAds class="h-7 w-7" />
						{:else}
							<IconTiktok class="h-7 w-7" />
						{/if}
						<div>
							<p class="font-semibold">{platform.label}</p>
							<p class="text-xs text-muted-foreground">{platform.description}</p>
						</div>
					</div>
					<ChevronRightIcon class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
				</a>
			{/each}
		</div>
	</div>
</div>
