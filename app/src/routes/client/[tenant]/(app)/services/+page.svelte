<script lang="ts">
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import WandIcon from '@lucide/svelte/icons/wand';
	import DiscountsDialog from '$lib/components/services/DiscountsDialog.svelte';
	import {
		CATEGORIES,
		CRM_FEATURES,
		TIERS,
		TIER_LABELS,
		TIER_COLORS,
		formatFeatureValue,
		isBooleanFeature,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import PackageComparisonDialog from '../../../../[tenant]/services/PackageComparisonDialog.svelte';
	import RequestPackageDialog from './RequestPackageDialog.svelte';

	let selectedCategory = $state<Category | null>(null);
	let compareOpen = $state(false);

	let requestCategory = $state<Category | null>(null);
	let requestTier = $state<Tier | null>(null);
	let requestOpen = $state(false);

	let discountsOpen = $state(false);

	const tenantSlug = $derived(page.params.tenant);

	function openCompare(cat: Category) {
		selectedCategory = cat;
		compareOpen = true;
	}

	function handleRequestFromCompare(tier: Tier) {
		if (!selectedCategory) return;
		requestCategory = selectedCategory;
		requestTier = tier;
		compareOpen = false;
		requestOpen = true;
	}

	function formatEur(value: number | null): string {
		if (value === null) return '—';
		return `${value.toLocaleString('ro-RO')} €`;
	}
</script>

<svelte:head>
	<title>Servicii & Oferte</title>
</svelte:head>

<div class="container mx-auto px-4 py-6 max-w-7xl">
	<div class="mb-8 flex items-start justify-between gap-4 flex-wrap">
		<div class="min-w-0">
			<h1 class="text-3xl font-bold tracking-tight">Servicii & Oferte OTS</h1>
			<p class="text-muted-foreground mt-2">
				Alege pachetul care se potrivește proiectului tău. Toate includ acces CRM real-time, gratuit.
			</p>
		</div>
		<button
			type="button"
			onclick={() => (discountsOpen = true)}
			class="group shrink-0 inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 dark:from-amber-500 dark:to-amber-600 text-white shadow-md shadow-amber-200/50 dark:shadow-amber-900/30 hover:shadow-lg hover:shadow-amber-300/50 hover:from-amber-500 hover:to-amber-600 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
		>
			<span class="flex items-center justify-center w-9 h-9 rounded-full bg-white/20 group-hover:bg-white/30 transition-colors">
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

	<section class="mb-10">
		<div class="flex items-center gap-2 mb-1">
			<SparklesIcon class="h-3.5 w-3.5 text-primary" />
			<span class="text-[11px] font-medium uppercase tracking-wider text-primary">Inclus gratuit</span>
		</div>
		<h2 class="text-base font-semibold">Acces CRM real-time în toate pachetele</h2>
		<p class="text-sm text-muted-foreground mt-1 mb-4">
			Spend, conversii, poziții SEO, uptime, open rate — live, 24/7.
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

	<a
		href={`/client/${tenantSlug}/services/exemplu`}
		class="group block mb-10 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-primary/10 to-transparent p-5 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
	>
		<div class="flex items-center gap-4">
			<div class="rounded-lg bg-primary/15 p-3 shrink-0">
				<WandIcon class="h-5 w-5 text-primary" />
			</div>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2 mb-0.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-primary">
						Wizard
					</span>
				</div>
				<h2 class="font-semibold leading-tight">Nu știi ce pachet să alegi? Hai să te ghidăm.</h2>
				<p class="text-sm text-muted-foreground mt-1">
					5 întrebări rapide (tip business, obiectiv, buget, canale) și îți spunem exact combinația
					care funcționează — cu preț estimat și discount aplicat.
				</p>
			</div>
			<ArrowRightIcon
				class="h-5 w-5 text-primary shrink-0 group-hover:translate-x-1 transition-transform"
			/>
		</div>
	</a>

	<h2 class="text-2xl font-bold mb-2">Categorii servicii</h2>
	<p class="text-sm text-muted-foreground mb-6">
		Click pe categorie pentru a vedea detaliile complete ale fiecărui tier și pentru a trimite
		cerere.
	</p>

	<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
		{#each CATEGORIES as category (category.slug)}
			<Card class="p-0 hover:border-primary/50 hover:shadow-md transition-all group">
				<button
					type="button"
					class="w-full text-left p-6 cursor-pointer"
					onclick={() => openCompare(category)}
				>
					<div class="flex items-start gap-3 mb-5">
						<div class="rounded-lg bg-muted/60 p-2.5 shrink-0">
							<CategoryIcon slug={category.slug} class="h-5 w-5" />
						</div>
						<div class="min-w-0 flex-1">
							<h3 class="font-semibold text-lg leading-tight">{category.name}</h3>
							<p class="text-xs text-muted-foreground mt-1">{category.tagline}</p>
						</div>
					</div>

					<div class="space-y-2 mb-5">
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

					<div
						class="flex items-center justify-between text-xs font-medium text-primary group-hover:gap-2 transition-all"
					>
						<span>Vezi detalii + cere ofertă</span>
						<ArrowRightIcon class="h-3.5 w-3.5" />
					</div>
				</button>
			</Card>
		{/each}
	</div>

	<div class="mt-8 flex flex-wrap gap-2 items-center">
		<Badge variant="outline">EUR fără TVA</Badge>
		<Badge variant="outline">Contract minim: 1-6 luni (în funcție de serviciu)</Badge>
		<button
			type="button"
			onclick={() => (discountsOpen = true)}
			class="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors cursor-pointer"
		>
			<PercentIcon class="h-3 w-3" />
			Discount multi-servicii disponibil
		</button>
	</div>
	<p class="text-xs text-muted-foreground mt-2">
		Toate prețurile sunt pentru management. Bugetul media (Ads) și costul platformelor externe
		(Brevo, Mailchimp, HubSpot etc.) se plătesc separat direct către furnizor.
	</p>
</div>

<PackageComparisonDialog
	bind:open={compareOpen}
	category={selectedCategory}
	onRequest={handleRequestFromCompare}
/>

<RequestPackageDialog bind:open={requestOpen} category={requestCategory} tier={requestTier} />

<DiscountsDialog bind:open={discountsOpen} />
