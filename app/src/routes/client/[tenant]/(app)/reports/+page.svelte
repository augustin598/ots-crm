<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import BarChart2Icon from '@lucide/svelte/icons/bar-chart-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import ThumbsUpIcon from '@lucide/svelte/icons/thumbs-up';
	import PlayIcon from '@lucide/svelte/icons/play';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import TargetIcon from '@lucide/svelte/icons/target';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { getConversionTypeConfig } from '$lib/utils/conversion-type-config';
	import * as Popover from '$lib/components/ui/popover';
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

	// ---- Streaming: merge API conversion data when it arrives ----
	let apiConversionsLoaded = $state(false);
	let apiError = $state<string | null>(null);
	let enrichedPlatformMetrics: typeof data.platformMetrics = $state(undefined!);

	const apiConversionsRef = $derived(data.apiConversions);
	const platformMetricsRef = $derived(data.platformMetrics);
	const googleAccountsRef = $derived(data.googleAccounts);

	$effect(() => {
		apiConversionsLoaded = false;
		apiError = null;
		enrichedPlatformMetrics = platformMetricsRef;

		let isCurrent = true; // cleanup flag to prevent stale data

		if (apiConversionsRef) {
			apiConversionsRef.then((apiData: any) => {
				if (!isCurrent || !apiData) return;
				enrichedPlatformMetrics = platformMetricsRef.map((p: any) => {
					if (p.iconKey === 'meta' && apiData.meta) {
						const m = apiData.meta;
						return {
							...p,
							conversions: m.conversions,
							revenue: m.revenue,
							hasConversions: m.conversions > 0,
							conversionLabel: m.conversionLabel,
							breakdown: m.breakdown,
							accounts: p.accounts.map((a: any) => {
								const conv = m.accounts[a.adAccountId || ''];
								if (!conv) return a;
								return { ...a, conversions: conv.conversions, revenue: conv.revenue, conversionLabel: conv.label, breakdown: conv.breakdown };
							})
						};
					}
					if (p.iconKey === 'google' && apiData.google) {
						const g = apiData.google;
						return {
							...p,
							conversions: g.conversions || p.conversions,
							revenue: g.revenue,
							hasConversions: (g.conversions || p.conversions) > 0,
							conversionLabel: g.conversionLabel,
							breakdown: g.breakdown,
							accounts: p.accounts.map((a: any) => {
								const accId = googleAccountsRef.find((ga: any) => ga.accountName === a.accountName)?.accountId;
								const conv = accId ? g.accounts[accId] : undefined;
								if (!conv) return a;
								return { ...a, conversions: conv.conversions, revenue: conv.revenue, conversionLabel: conv.label, breakdown: conv.breakdown };
							})
						};
					}
					return p;
				});
				apiConversionsLoaded = true;
			}).catch((err: any) => {
				if (!isCurrent) return;
				apiError = 'Nu s-au putut încărca rezultatele din Meta/Google Ads.';
				apiConversionsLoaded = true;
			});
		}

		return () => { isCurrent = false; };
	});

	const activeCurrencies = $derived(new Set([
		...(data.adSpend.meta > 0 ? [data.adSpend.metaCurrency] : []),
		...(data.adSpend.google > 0 ? [data.adSpend.googleCurrency] : []),
		...(data.adSpend.tiktok > 0 ? [data.adSpend.tiktokCurrency] : [])
	]));
	const sameCurrency = $derived(activeCurrencies.size <= 1);
	const mainCurrency = $derived(activeCurrencies.values().next().value ?? 'RON');

	const CONV_ICON_MAP: Record<string, any> = {
		'shopping-cart': ShoppingCartIcon,
		'users': UsersIcon,
		'phone': PhoneIcon,
		'mouse-pointer-click': MousePointerClickIcon,
		'file-text': FileTextIcon,
		'heart': HeartIcon,
		'thumbs-up': ThumbsUpIcon,
		'play': PlayIcon,
		'message-circle': MessageCircleIcon,
		'download': DownloadIcon,
		'megaphone': MegaphoneIcon,
		'eye': EyeIcon,
		'target': TargetIcon,
		'user-plus': UserPlusIcon
	};

	let expandedPlatforms = $state<Set<string>>(new Set());
	function togglePlatform(name: string) {
		const next = new Set(expandedPlatforms);
		if (next.has(name)) next.delete(name); else next.add(name);
		expandedPlatforms = next;
	}

	function fmtNum(n: number): string { return n.toLocaleString('ro-RO', { maximumFractionDigits: 0 }); }
	function fmtPct(n: number): string { return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
	function fmtCurrency(cents: number, currency: string): string {
		return (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
	}
	function cpcFromCents(spendCents: number, clicks: number, currency: string): string {
		if (clicks <= 0) return '-';
		return (spendCents / 100 / clicks).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
	}

	const platforms = $derived([
		{
			label: 'Meta Ads',
			description: 'Facebook & Instagram Ads',
			href: `/client/${tenantSlug}/reports/facebook-ads`,
			color: 'bg-blue-500/10',
			icon: 'meta' as const,
			accounts: data.metaAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		},
		{
			label: 'Google Ads',
			description: 'Search, Display & YouTube',
			href: `/client/${tenantSlug}/reports/google-ads`,
			color: 'bg-green-500/10',
			icon: 'google' as const,
			accounts: data.googleAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		},
		{
			label: 'TikTok Ads',
			description: 'TikTok For Business',
			href: `/client/${tenantSlug}/reports/tiktok-ads`,
			color: 'bg-pink-500/10',
			icon: 'tiktok' as const,
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

	<!-- Platform comparison table -->
	{#if apiError}
		<div class="rounded-md p-3 bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
			<p class="text-sm text-amber-800 dark:text-amber-300">{apiError}</p>
		</div>
	{/if}

	{#if enrichedPlatformMetrics && enrichedPlatformMetrics.length > 0}
		<Card.Root class="p-4">
			<h3 class="mb-4 text-lg font-semibold">Comparație platforme</h3>
			<div class="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Platformă</TableHead>
							<TableHead class="text-right">Buget reclame</TableHead>
							<TableHead class="text-right">Impresii</TableHead>
							<TableHead class="text-right">Click-uri</TableHead>
							<TableHead class="text-right">CPC</TableHead>
							<TableHead class="text-right">CTR</TableHead>
							<TableHead class="text-right">Rezultate</TableHead>
							<TableHead class="text-right">Cost</TableHead>
							<TableHead class="text-right">Cost/rezultat</TableHead>
							<TableHead class="text-right">Venituri</TableHead>
							<TableHead class="text-right">ROAS</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each enrichedPlatformMetrics as p}
							<TableRow
								class="{p.accounts.length > 1 ? 'cursor-pointer' : ''} hover:bg-muted/40 {expandedPlatforms.has(p.name) ? 'bg-muted/30 font-semibold' : ''}"
								onclick={() => p.accounts.length > 1 ? togglePlatform(p.name) : null}
							>
								<TableCell class="font-medium">
									<div class="flex items-center gap-2">
										{#if p.accounts.length > 1}
											{#if expandedPlatforms.has(p.name)}
												<ChevronDownIcon class="h-4 w-4 shrink-0 text-primary" />
											{:else}
												<ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
											{/if}
										{/if}
										{#if p.iconKey === 'meta'}<IconFacebook class="h-5 w-5" />
										{:else if p.iconKey === 'google'}<IconGoogleAds class="h-5 w-5" />
										{:else}<IconTiktok class="h-5 w-5" />{/if}
										{p.name}
									</div>
								</TableCell>
								<TableCell class="text-right">{fmtCurrency(p.spend, p.currency)}</TableCell>
								<TableCell class="text-right">{fmtNum(p.impressions)}</TableCell>
								<TableCell class="text-right">{fmtNum(p.clicks)}</TableCell>
								<TableCell class="text-right">{cpcFromCents(p.spend, p.clicks, p.currency)}</TableCell>
								<TableCell class="text-right">{p.impressions > 0 ? fmtPct((p.clicks / p.impressions) * 100) : '-'}</TableCell>
								<TableCell class="text-right" onclick={(e) => e.stopPropagation()}>
									{#if !apiConversionsLoaded && p.iconKey !== 'tiktok'}
										<div class="flex flex-col items-end gap-1">
											<div class="h-5 w-12 bg-muted rounded animate-pulse"></div>
											<div class="h-3 w-20 bg-muted rounded animate-pulse"></div>
										</div>
									{:else if p.hasConversions && p.conversions > 0}
										<Popover.Root>
											<Popover.Trigger class="text-right cursor-pointer hover:opacity-80 transition-opacity">
												<div class="font-semibold">{fmtNum(p.conversions)}</div>
												<div class="flex flex-wrap gap-0.5 justify-end mt-0.5">
													{#each (p.breakdown || []).slice(0, 2) as b}
														{@const tc = getConversionTypeConfig(b.type)}
														{@const TcIcon = CONV_ICON_MAP[tc.icon] || TargetIcon}
														<span class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[9px] font-medium {tc.color}">
															<TcIcon class="h-2.5 w-2.5" />{fmtNum(Math.round(b.conversions))}
														</span>
													{/each}
													{#if (p.breakdown || []).length > 2}
														<span class="text-[9px] text-muted-foreground">+{(p.breakdown || []).length - 2}</span>
													{/if}
												</div>
											</Popover.Trigger>
											<Popover.Content class="w-72 p-3" side="top" align="end">
												<p class="mb-2 text-xs font-semibold text-muted-foreground">Rezultate {p.name}</p>
												<div class="space-y-1.5 text-xs">
													{#each p.breakdown || [] as b}
														{@const tc = getConversionTypeConfig(b.type)}
														{@const TcIcon = CONV_ICON_MAP[tc.icon] || TargetIcon}
														<div class="flex items-center justify-between">
															<span class="inline-flex items-center gap-1.5 text-muted-foreground">
																<TcIcon class="h-3 w-3" />
																{tc.label || b.type}
															</span>
															<div class="text-right">
																<span class="font-medium">{fmtNum(Math.round(b.conversions))}</span>
																{#if b.revenue > 0}
																	<span class="text-muted-foreground ml-1">· {fmtCurrency(Math.round(b.revenue * 100), p.currency)}</span>
																{/if}
															</div>
														</div>
													{/each}
													<div class="border-t pt-1.5 mt-1.5">
														<div class="flex items-center justify-between text-muted-foreground">
															<span>Total</span>
															<span class="font-medium">{fmtNum(p.conversions)} rezultate</span>
														</div>
														{#if p.revenue > 0}
															<div class="flex items-center justify-between text-muted-foreground mt-1">
																<span>Venituri</span>
																<span class="font-medium">{fmtCurrency(Math.round(p.revenue * 100), p.currency)}</span>
															</div>
														{/if}
													</div>
												</div>
											</Popover.Content>
										</Popover.Root>
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</TableCell>
								<TableCell class="text-right">{fmtCurrency(p.spend, p.currency)}</TableCell>
								<TableCell class="text-right">
									{#if !apiConversionsLoaded && p.iconKey !== 'tiktok'}
										<div class="h-4 w-14 bg-muted rounded animate-pulse ml-auto"></div>
									{:else if p.hasConversions && p.conversions > 0 && p.spend > 0}
										{fmtCurrency(Math.round(p.spend / p.conversions), p.currency)}
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</TableCell>
								<TableCell class="text-right">
									{#if !apiConversionsLoaded && p.iconKey !== 'tiktok'}
										<div class="h-4 w-16 bg-muted rounded animate-pulse ml-auto"></div>
									{:else if p.revenue > 0}
										{fmtCurrency(Math.round(p.revenue * 100), p.currency)}
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</TableCell>
								<TableCell class="text-right">
									{#if !apiConversionsLoaded && p.iconKey !== 'tiktok'}
										<div class="h-4 w-10 bg-muted rounded animate-pulse ml-auto"></div>
									{:else if p.revenue > 0 && p.spend > 0}
										<span class="font-semibold {p.revenue / (p.spend / 100) >= 1 ? 'text-green-600' : 'text-red-600'}">
											{(p.revenue / (p.spend / 100)).toFixed(2)}x
										</span>
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</TableCell>
							</TableRow>
							<!-- Expanded per-account rows -->
							{#if expandedPlatforms.has(p.name) && p.accounts.length > 1}
								{#each p.accounts as account}
									<TableRow class="bg-muted/15 text-muted-foreground">
										<TableCell>
											<div class="pl-10 text-sm font-medium">{account.accountName}</div>
										</TableCell>
										<TableCell class="text-right text-sm">{fmtCurrency(account.spendCents, account.currency)}</TableCell>
										<TableCell class="text-right text-sm">{account.impressions > 0 ? fmtNum(account.impressions) : '-'}</TableCell>
										<TableCell class="text-right text-sm">{account.clicks > 0 ? fmtNum(account.clicks) : '-'}</TableCell>
										<TableCell class="text-right text-sm">{account.clicks > 0 ? cpcFromCents(account.spendCents, account.clicks, account.currency) : '-'}</TableCell>
										<TableCell class="text-right text-sm">{account.impressions > 0 && account.clicks > 0 ? fmtPct((account.clicks / account.impressions) * 100) : '-'}</TableCell>
										<TableCell class="text-right text-sm">{account.conversions > 0 ? fmtNum(account.conversions) : '-'}</TableCell>
										<TableCell class="text-right text-sm">{fmtCurrency(account.spendCents, account.currency)}</TableCell>
										<TableCell class="text-right text-sm">{account.conversions > 0 && account.spendCents > 0 ? fmtCurrency(Math.round(account.spendCents / account.conversions), account.currency) : '-'}</TableCell>
										<TableCell class="text-right text-sm">
											{#if account.revenue > 0}
												{fmtCurrency(Math.round(account.revenue * 100), account.currency)}
											{:else}-{/if}
										</TableCell>
										<TableCell class="text-right text-sm">
											{#if account.revenue > 0 && account.spendCents > 0}
												<span class="{account.revenue / (account.spendCents / 100) >= 1 ? 'text-green-600' : 'text-red-600'}">
													{(account.revenue / (account.spendCents / 100)).toFixed(2)}x
												</span>
											{:else}-{/if}
										</TableCell>
									</TableRow>
									<!-- Conversion breakdown rows per account -->
									{#if account.breakdown && account.breakdown.length > 0}
										{#each account.breakdown as conv}
											{@const typeConfig = getConversionTypeConfig(conv.type)}
											{@const ConvIcon = CONV_ICON_MAP[typeConfig.icon] || TargetIcon}
											{@const hasFullMetrics = conv.spend > 0 || conv.impressions > 0}
											{@const spendCents = hasFullMetrics ? Math.round(conv.spend * 100) : 0}
											{@const costPerResult = conv.conversions > 0 && spendCents > 0 ? spendCents / conv.conversions : 0}
											<TableRow class="bg-muted/5">
												<TableCell>
													<div class="pl-12 text-xs flex items-center gap-1.5">
														<span class="text-muted-foreground/30">└</span>
														<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium {typeConfig.color}">
															<ConvIcon class="h-3 w-3" />
															{typeConfig.label || conv.type}
														</span>
													</div>
												</TableCell>
												<TableCell class="text-right text-xs">{#if hasFullMetrics}{fmtCurrency(spendCents, account.currency)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">{#if conv.impressions > 0}{fmtNum(conv.impressions)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">{#if conv.clicks > 0}{fmtNum(conv.clicks)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">{#if conv.clicks > 0 && spendCents > 0}{fmtCurrency(Math.round(spendCents / conv.clicks), account.currency)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">{#if conv.impressions > 0 && conv.clicks > 0}{fmtPct((conv.clicks / conv.impressions) * 100)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs font-medium">{fmtNum(Math.round(conv.conversions))}</TableCell>
												<TableCell class="text-right text-xs">{#if spendCents > 0}{fmtCurrency(spendCents, account.currency)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">{#if costPerResult > 0}{fmtCurrency(Math.round(costPerResult), account.currency)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">{#if conv.revenue > 0}{fmtCurrency(Math.round(conv.revenue * 100), account.currency)}{:else}<span class="text-muted-foreground">-</span>{/if}</TableCell>
												<TableCell class="text-right text-xs">
													{#if conv.revenue > 0 && spendCents > 0}
														<span class="font-semibold {conv.revenue / (spendCents / 100) >= 1 ? 'text-green-600' : 'text-red-600'}">
															{(conv.revenue / (spendCents / 100)).toFixed(2)}x
														</span>
													{:else}<span class="text-muted-foreground">-</span>{/if}
												</TableCell>
											</TableRow>
										{/each}
									{/if}
								{/each}
							{/if}
						{/each}
						<!-- Total row — only if same currency -->
						{#if sameCurrency && enrichedPlatformMetrics.length > 1}
							{@const totSpend = enrichedPlatformMetrics.reduce((s: number, p: any) => s + p.spend, 0)}
							{@const totImpr = enrichedPlatformMetrics.reduce((s: number, p: any) => s + p.impressions, 0)}
							{@const totClicks = enrichedPlatformMetrics.reduce((s: number, p: any) => s + p.clicks, 0)}
							{@const totConv = enrichedPlatformMetrics.reduce((s: number, p: any) => s + (p.hasConversions ? p.conversions : 0), 0)}
							{@const totRevenue = enrichedPlatformMetrics.reduce((s: number, p: any) => s + (p.revenue || 0), 0)}
							<TableRow class="bg-muted/50 font-semibold border-t-2">
								<TableCell>Total</TableCell>
								<TableCell class="text-right">{fmtCurrency(totSpend, mainCurrency)}</TableCell>
								<TableCell class="text-right">{fmtNum(totImpr)}</TableCell>
								<TableCell class="text-right">{fmtNum(totClicks)}</TableCell>
								<TableCell class="text-right">{cpcFromCents(totSpend, totClicks, mainCurrency)}</TableCell>
								<TableCell class="text-right">{totImpr > 0 ? fmtPct((totClicks / totImpr) * 100) : '-'}</TableCell>
								<TableCell class="text-right">{totConv > 0 ? fmtNum(totConv) : '-'}</TableCell>
								<TableCell class="text-right">{fmtCurrency(totSpend, mainCurrency)}</TableCell>
								<TableCell class="text-right">{totConv > 0 && totSpend > 0 ? fmtCurrency(Math.round(totSpend / totConv), mainCurrency) : '-'}</TableCell>
								<TableCell class="text-right">{totRevenue > 0 ? fmtCurrency(Math.round(totRevenue * 100), mainCurrency) : '-'}</TableCell>
								<TableCell class="text-right">{totRevenue > 0 && totSpend > 0 ? (totRevenue / (totSpend / 100)).toFixed(2) + 'x' : '-'}</TableCell>
							</TableRow>
						{/if}
					</TableBody>
				</Table>
			</div>
			<p class="text-[10px] text-muted-foreground mt-3">
				* Rezultatele Meta Ads (achiziții, lead-uri, apeluri) sunt disponibile în raportul detaliat per platformă.
			</p>
		</Card.Root>
	{/if}

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
</div>
