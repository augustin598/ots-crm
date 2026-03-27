<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import BarChart2Icon from '@lucide/svelte/icons/bar-chart-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';

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

	const platforms = $derived([
		{
			label: 'Meta Ads',
			description: 'Facebook & Instagram Ads',
			href: `/client/${tenantSlug}/reports/facebook-ads`,
			color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
		},
		{
			label: 'Google Ads',
			description: 'Search, Display & YouTube',
			href: `/client/${tenantSlug}/reports/google-ads`,
			color: 'bg-green-500/10 text-green-600 dark:text-green-400'
		},
		{
			label: 'TikTok Ads',
			description: 'TikTok For Business',
			href: `/client/${tenantSlug}/reports/tiktok-ads`,
			color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
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
				<div class="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10">
					<DollarSignIcon class="h-4 w-4 text-blue-500" />
				</div>
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
				<div class="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/10">
					<DollarSignIcon class="h-4 w-4 text-green-500" />
				</div>
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
				<div class="flex h-8 w-8 items-center justify-center rounded-md bg-pink-500/10">
					<DollarSignIcon class="h-4 w-4 text-pink-500" />
				</div>
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
				<a
					href={platform.href}
					class="group flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/50"
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
			{/each}
		</div>
	</div>
</div>
