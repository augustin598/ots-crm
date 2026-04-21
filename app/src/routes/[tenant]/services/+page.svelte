<script lang="ts">
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import PackageIcon from '@lucide/svelte/icons/package';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import DiscountsDialog from '$lib/components/services/DiscountsDialog.svelte';
	import {
		CATEGORIES,
		CRM_FEATURES,
		TIERS,
		TIER_LABELS,
		TIER_COLORS,
		formatFeatureValue,
		isBooleanFeature,
		getCategory,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';
	import {
		getPackageRequests,
		updatePackageRequestStatus
	} from '$lib/remotes/packages.remote';
	import InvoiceItemsPanel from './InvoiceItemsPanel.svelte';
	import PackageComparisonDialog from './PackageComparisonDialog.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';

	let activeTab = $state(page.url.searchParams.get('tab') || 'packages');

	const requestsQuery = getPackageRequests();
	const requests = $derived(requestsQuery.current || []);
	const requestsLoading = $derived(requestsQuery.loading);

	let statusFilter = $state<'all' | 'pending' | 'contacted' | 'accepted' | 'rejected'>('all');
	const filteredRequests = $derived(
		statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter)
	);

	const STATUS_LABEL: Record<string, string> = {
		pending: 'În așteptare',
		contacted: 'Contactat',
		accepted: 'Acceptat',
		rejected: 'Respins'
	};

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'pending':
				return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
			case 'contacted':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
			case 'accepted':
				return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
			case 'rejected':
				return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}

	let selectedCategory = $state<Category | null>(null);
	let dialogOpen = $state(false);
	let discountsOpen = $state(false);

	function openCategory(cat: Category) {
		selectedCategory = cat;
		dialogOpen = true;
	}

	async function handleStatusChange(
		requestId: string,
		status: 'pending' | 'contacted' | 'accepted' | 'rejected'
	) {
		try {
			await updatePackageRequestStatus({ requestId, status }).updates(requestsQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Eroare la actualizare status');
		}
	}

	function categoryLabel(slug: string): string {
		return getCategory(slug)?.name || slug;
	}

	function formatEur(value: number | null): string {
		if (value === null) return '—';
		return `${value.toLocaleString('ro-RO')} €`;
	}

	function formatDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Servicii — CRM</title>
</svelte:head>

<div class="mb-6 flex items-start justify-between gap-4 flex-wrap">
	<div class="min-w-0">
		<h1 class="text-3xl font-bold tracking-tight">Servicii</h1>
		<p class="text-muted-foreground mt-1">
			Catalog pachete OTS pentru clienți + elemente de facturi.
		</p>
	</div>
	<button
		type="button"
		onclick={() => (discountsOpen = true)}
		class="group shrink-0 inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 dark:from-amber-500 dark:to-amber-600 text-white shadow-md shadow-amber-200/50 dark:shadow-amber-900/30 hover:shadow-lg hover:shadow-amber-300/50 hover:from-amber-500 hover:to-amber-600 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
	>
		<span
			class="flex items-center justify-center w-9 h-9 rounded-full bg-white/20 group-hover:bg-white/30 transition-colors"
		>
			<PercentIcon class="h-4 w-4" />
		</span>
		<span class="flex flex-col items-start">
			<span class="text-sm font-bold tracking-wide leading-tight">Discount multi-servicii</span>
			<span class="text-[11px] font-medium text-white/80 leading-tight mt-0.5">
				Economisești până la −22%
			</span>
		</span>
	</button>
</div>

<Tabs bind:value={activeTab} class="w-full">
	<TabsList>
		<TabsTrigger value="packages">
			<SparklesIcon class="mr-2 h-4 w-4" />
			Pachete OTS
		</TabsTrigger>
		<TabsTrigger value="requests">
			<InboxIcon class="mr-2 h-4 w-4" />
			Cereri clienți
			{#if requests.filter((r) => r.status === 'pending').length > 0}
				<Badge class="ml-2" variant="default">
					{requests.filter((r) => r.status === 'pending').length}
				</Badge>
			{/if}
		</TabsTrigger>
		<TabsTrigger value="invoice-items">
			<PackageIcon class="mr-2 h-4 w-4" />
			Elemente de facturi
		</TabsTrigger>
	</TabsList>

	<TabsContent value="packages" class="mt-6">
		<section class="mb-10">
			<div class="flex items-center gap-2 mb-1">
				<SparklesIcon class="h-3.5 w-3.5 text-primary" />
				<span class="text-[11px] font-medium uppercase tracking-wider text-primary">Inclus gratuit</span>
			</div>
			<h2 class="text-base font-semibold">Acces CRM real-time — diferențiatorul OTS</h2>
			<p class="text-sm text-muted-foreground mt-1 mb-4">
				Clientul vede spend, conversii, poziții SEO, uptime și email stats live, 24/7.
			</p>
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="bg-muted/30">
						<tr>
							<th class="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Feature CRM</th>
							{#each TIERS as tier (tier)}
								{@const colors = TIER_COLORS[tier]}
								<th class="px-3 py-2 text-xs font-semibold text-center {colors.text}">
									<div class="inline-flex items-center gap-1.5">
										<span class="h-1.5 w-1.5 rounded-full {colors.dot}"></span>
										{TIER_LABELS[tier]}
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each CRM_FEATURES as feat (feat.id)}
							<tr class="border-t">
								<td class="px-3 py-2">{feat.label}</td>
								{#each TIERS as tier (tier)}
									{@const value = feat.values[tier]}
									<td class="px-3 py-2 text-center">
										{#if isBooleanFeature(value)}
											{#if value}
												<CheckIcon class="mx-auto h-3.5 w-3.5 text-green-600 dark:text-green-400" />
											{:else}
												<MinusIcon class="mx-auto h-3.5 w-3.5 text-muted-foreground/30" />
											{/if}
										{:else}
											<span class="font-medium text-xs">{formatFeatureValue(value)}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<h2 class="text-xl font-semibold mb-4">Categorii servicii</h2>
		<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{#each CATEGORIES as category (category.slug)}
				<Card class="p-0 hover:border-primary/50 hover:shadow-sm transition-all">
					<button
						type="button"
						class="w-full text-left p-6 cursor-pointer"
						onclick={() => openCategory(category)}
					>
						<div class="flex items-start gap-3 mb-4">
							<div class="rounded-lg bg-muted/60 p-2.5 shrink-0">
								<CategoryIcon slug={category.slug} class="h-5 w-5" />
							</div>
							<div class="min-w-0 flex-1">
								<h3 class="font-semibold text-lg leading-tight">{category.name}</h3>
								<p class="text-xs text-muted-foreground mt-1">{category.tagline}</p>
							</div>
						</div>
						<div class="space-y-2 mb-4">
							{#each TIERS as tier (tier)}
								{@const colors = TIER_COLORS[tier]}
								{@const price = category.prices[tier]}
								{@const setup = category.setupFees?.[tier]}
								{#if price !== null || setup}
									<div
										class="flex items-center justify-between px-3 py-2 rounded-md border {colors.border} {colors.bg}"
									>
										<div class="flex items-center gap-2">
											<span class="h-2 w-2 rounded-full {colors.dot}"></span>
											<span class="text-xs font-semibold {colors.text}">{TIER_LABELS[tier]}</span>
										</div>
										<span class="text-xs font-bold {colors.text}">
											{#if price !== null}
												{formatEur(price)}<span class="font-normal opacity-70">/lună</span>
											{:else if setup}
												{formatEur(setup)}<span class="font-normal opacity-70"> one-time</span>
											{/if}
										</span>
									</div>
								{/if}
							{/each}
						</div>
						<p class="text-xs text-primary font-medium">Vezi comparație tier-uri →</p>
					</button>
				</Card>
			{/each}
		</div>
	</TabsContent>

	<TabsContent value="requests" class="mt-6">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h2 class="text-xl font-semibold">Cereri primite de la clienți</h2>
				<p class="text-sm text-muted-foreground mt-1">
					Când un client cere un pachet din portal, apare aici și tu primești email.
				</p>
			</div>
			<Select type="single" bind:value={statusFilter}>
				<SelectTrigger class="w-[200px]">
					{statusFilter === 'all' ? 'Toate statusurile' : STATUS_LABEL[statusFilter]}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">Toate statusurile</SelectItem>
					<SelectItem value="pending">În așteptare</SelectItem>
					<SelectItem value="contacted">Contactat</SelectItem>
					<SelectItem value="accepted">Acceptat</SelectItem>
					<SelectItem value="rejected">Respins</SelectItem>
				</SelectContent>
			</Select>
		</div>

		{#if requestsLoading}
			<p class="text-muted-foreground">Se încarcă...</p>
		{:else if filteredRequests.length === 0}
			<Card>
				<div class="p-10 text-center">
					<InboxIcon class="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
					<p class="text-muted-foreground">Nicio cerere încă.</p>
				</div>
			</Card>
		{:else}
			<div class="space-y-3">
				{#each filteredRequests as req (req.id)}
					{@const tierColors = TIER_COLORS[req.tier as Tier]}
					<Card class="p-4" id={`req-${req.id}`}>
						<div class="flex items-start justify-between gap-4 flex-wrap">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap mb-1.5">
									<div class="flex items-center gap-2">
										<CategoryIcon slug={req.categorySlug} class="h-4 w-4" />
										<h3 class="font-semibold">{categoryLabel(req.categorySlug)}</h3>
									</div>
									<span
										class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border {tierColors.border} {tierColors.text} {tierColors.bg}"
									>
										<span class="h-1.5 w-1.5 rounded-full {tierColors.dot}"></span>
										{TIER_LABELS[req.tier as Tier] ?? req.tier}
									</span>
									<Badge class={statusBadgeClass(req.status)}>
										{STATUS_LABEL[req.status] ?? req.status}
									</Badge>
								</div>
								<p class="text-sm text-muted-foreground">
									{req.clientName || '—'}
									{#if req.clientEmail}
										<span class="mx-1">·</span>
										<a href={`mailto:${req.clientEmail}`} class="hover:underline">{req.clientEmail}</a>
									{/if}
									<span class="mx-1">·</span>
									{formatDate(req.createdAt)}
								</p>
								{#if req.note}
									<p class="text-sm mt-2 p-3 rounded bg-muted/50 whitespace-pre-line">
										{req.note}
									</p>
								{/if}
							</div>
							<div class="flex gap-2 flex-shrink-0">
								{#if req.status === 'pending'}
									<Button
										size="sm"
										variant="outline"
										onclick={() => handleStatusChange(req.id, 'contacted')}
									>
										Marchează contactat
									</Button>
								{/if}
								{#if req.status !== 'accepted' && req.status !== 'rejected'}
									<Button
										size="sm"
										variant="outline"
										onclick={() => handleStatusChange(req.id, 'accepted')}
									>
										Acceptă
									</Button>
									<Button
										size="sm"
										variant="outline"
										onclick={() => handleStatusChange(req.id, 'rejected')}
									>
										Respinge
									</Button>
								{/if}
							</div>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</TabsContent>

	<TabsContent value="invoice-items" class="mt-6">
		<InvoiceItemsPanel />
	</TabsContent>
</Tabs>

<PackageComparisonDialog bind:open={dialogOpen} category={selectedCategory} />

<DiscountsDialog bind:open={discountsOpen} />
