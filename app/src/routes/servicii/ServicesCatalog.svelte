<!--
	Catalogul public de servicii (starea „deblocată" a paginii /servicii).

	Toate datele vin prin props, de la `+page.server.ts` — vezi comentariul din
	`types.ts` pentru motivul (prețurile nu trebuie să ajungă în bundle-ul de
	client al vizitatorilor care n-au introdus parola).
-->
<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import PackageComparisonView from '$lib/components/services/PackageComparisonView.svelte';
	import RequestQuoteDialog from './RequestQuoteDialog.svelte';
	import { formatEur, formatFeatureValue, isBooleanFeature } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier } from '$lib/constants/ots-catalog';
	import type { PublicCatalog, PublicCompany } from './types';

	type Props = {
		catalog: PublicCatalog;
		company: PublicCompany;
	};

	let { catalog, company }: Props = $props();

	const bySlug = $derived(new Map(catalog.categories.map((c) => [c.slug, c])));
	const webDevSlugs = $derived(new Set(catalog.webDevSlugs));

	let activeGroupId = $state<string>('all');
	const visibleGroups = $derived(
		activeGroupId === 'all'
			? catalog.groups
			: catalog.groups.filter((g) => g.id === activeGroupId)
	);

	function categoriesInGroup(slugs: string[]): Category[] {
		return slugs.map((s) => bySlug.get(s)).filter((c): c is Category => c !== undefined);
	}

	let selectedCategory = $state<Category | null>(null);
	let compareOpen = $state(false);

	let requestCategory = $state<Category | null>(null);
	let requestTier = $state<Tier | null>(null);
	let requestOpen = $state(false);
	// Incrementat la fiecare deschidere: cheia din {#key} montează un dialog curat,
	// fără stare rămasă de la cererea anterioară.
	let requestSeq = $state(0);

	const isWebDev = $derived(selectedCategory ? webDevSlugs.has(selectedCategory.slug) : false);

	function openCompare(cat: Category) {
		selectedCategory = cat;
		compareOpen = true;
	}

	function handleRequest(tier: Tier) {
		if (!selectedCategory) return;
		requestCategory = selectedCategory;
		requestTier = tier;
		compareOpen = false;
		requestSeq += 1;
		requestOpen = true;
	}

	const currentYear = new Date().getFullYear();
</script>

<div class="min-h-screen bg-background text-foreground">
	<header class="border-b bg-card/60 backdrop-blur sticky top-0 z-30">
		<div class="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
			<a href="/servicii" class="flex items-center gap-3 min-w-0">
				<img src="/onetop-logo.png" alt="One Top Solution" class="h-8 w-auto" />
				<span class="text-sm font-semibold tracking-tight hidden sm:inline">Servicii & Pachete</span>
			</a>
			<form method="POST" action="?/lock">
				<Button type="submit" variant="ghost" size="sm" class="text-muted-foreground">
					<LogOutIcon class="h-4 w-4 mr-1.5" />
					Ieși
				</Button>
			</form>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 sm:px-6 py-10">
		<!-- Hero -->
		<section class="mb-12">
			<Badge variant="outline" class="mb-3">Ofertă OTS</Badge>
			<h1 class="text-4xl sm:text-5xl font-bold tracking-tight">Servicii & Pachete</h1>
			<p class="text-muted-foreground mt-3 max-w-2xl text-lg">
				Marketing, web și hosting, structurate pe patru niveluri — de la Bronze la Platinum. Alege
				categoria care te interesează și vezi exact ce include fiecare pachet.
			</p>
			<div class="flex flex-wrap gap-2 mt-5">
				<Badge variant="outline">Prețuri în EUR, fără TVA</Badge>
				<Badge variant="outline">Acces CRM real-time inclus</Badge>
				<Badge variant="outline">Contract minim 1–6 luni, în funcție de serviciu</Badge>
			</div>
		</section>

		<!-- CRM inclus -->
		<section class="mb-14">
			<div class="flex items-center gap-2 mb-1">
				<SparklesIcon class="h-3.5 w-3.5 text-primary" />
				<span class="text-[11px] font-medium uppercase tracking-wider text-primary">
					Inclus gratuit
				</span>
			</div>
			<h2 class="text-xl font-semibold">Acces CRM real-time în toate pachetele</h2>
			<p class="text-sm text-muted-foreground mt-1 mb-4">
				Spend, conversii, poziții SEO, uptime, open rate — live, 24/7, în contul tău.
			</p>
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="bg-muted/30">
						<tr>
							<th class="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
								Feature CRM
							</th>
							{#each catalog.tiers as tier (tier)}
								{@const colors = catalog.tierColors[tier]}
								<th class="px-3 py-2 text-xs font-semibold text-center {colors.text}">
									<div class="inline-flex items-center gap-1.5">
										<span class="h-1.5 w-1.5 rounded-full {colors.dot}"></span>
										{catalog.tierLabels[tier]}
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each catalog.crmFeatures as feat (feat.id)}
							<tr class="border-t">
								<td class="px-3 py-2">{feat.label}</td>
								{#each catalog.tiers as tier (tier)}
									{@const value = feat.values[tier]}
									<td class="px-3 py-2 text-center">
										{#if isBooleanFeature(value)}
											{#if value}
												<CheckIcon class="mx-auto h-3.5 w-3.5 text-green-600" />
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

		<!-- Discount multi-servicii -->
		{#if catalog.discountRules.length > 0}
			<section class="mb-14 rounded-xl border bg-muted/30 p-6">
				<div class="flex items-center gap-2 mb-1">
					<PercentIcon class="h-4 w-4 text-primary" />
					<h2 class="text-lg font-semibold">Discount multi-servicii</h2>
				</div>
				<p class="text-sm text-muted-foreground mb-5">
					Discountul se aplică pe abonamentul lunar combinat (nu pe bugetul media sau pe costul
					platformelor externe).
				</p>
				<div class="grid gap-3 sm:grid-cols-3">
					{#each catalog.discountRules as rule (rule.minServices)}
						<div class="rounded-lg border bg-background p-4 text-center">
							<div class="text-3xl font-bold text-primary leading-none">−{rule.discountPct}%</div>
							<div class="text-xs text-muted-foreground mt-2">{rule.label}</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Categorii -->
		<section>
			<div class="mb-5">
				<h2 class="text-3xl font-bold tracking-tight">Categorii servicii</h2>
				<p class="text-sm text-muted-foreground mt-1.5">
					Click pe orice categorie pentru comparația completă Bronze → Platinum și cerere de ofertă.
				</p>
			</div>

			<div class="flex flex-wrap gap-2 mb-8">
				<button
					type="button"
					onclick={() => (activeGroupId = 'all')}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer {activeGroupId ===
					'all'
						? 'bg-primary text-primary-foreground border-primary'
						: 'bg-background hover:bg-muted border-border'}"
				>
					Toate
					<span class="text-[10px] opacity-70">({catalog.categories.length})</span>
				</button>
				{#each catalog.groups as group (group.id)}
					<button
						type="button"
						onclick={() => (activeGroupId = group.id)}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer {activeGroupId ===
						group.id
							? 'bg-primary text-primary-foreground border-primary'
							: 'bg-background hover:bg-muted border-border'}"
					>
						{group.label}
						<span class="text-[10px] opacity-70">({categoriesInGroup(group.slugs).length})</span>
					</button>
				{/each}
			</div>

			{#each visibleGroups as group (group.id)}
				{@const items = categoriesInGroup(group.slugs)}
				{#if items.length > 0}
					<section class="mb-10">
						<div class="mb-4">
							<h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
								{group.label}
							</h3>
							<p class="text-xs text-muted-foreground/80 mt-0.5">{group.description}</p>
						</div>
						<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
							{#each items as category (category.slug)}
								{@const monthlyPrices = catalog.tiers
									.map((t) => category.prices[t])
									.filter((p): p is number => p !== null)}
								{@const setupOnly =
									monthlyPrices.length === 0 && category.setupFees
										? Object.values(category.setupFees).filter((p): p is number => p !== undefined)
										: []}
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
										<div class="flex items-baseline justify-between mt-2 mb-1">
											{#if monthlyPrices.length > 0}
												<span class="text-2xl font-bold">
													{formatEur(Math.min(...monthlyPrices))}
													<span class="text-sm font-normal text-muted-foreground">/lună</span>
												</span>
												<span class="text-xs text-muted-foreground">
													până la {formatEur(Math.max(...monthlyPrices))}
												</span>
											{:else if setupOnly.length > 0}
												<span class="text-2xl font-bold">
													{formatEur(setupOnly[0])}
													<span class="text-sm font-normal text-muted-foreground">one-time</span>
												</span>
											{/if}
										</div>
										<p class="text-xs text-muted-foreground mb-5">
											{#if monthlyPrices.length > 0}
												{monthlyPrices.length} pachete: {catalog.tierLabels[catalog.tiers[0]]} → {catalog
													.tierLabels[catalog.tiers[catalog.tiers.length - 1]]}
											{/if}
										</p>
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
					</section>
				{/if}
			{/each}
		</section>

		<p class="text-xs text-muted-foreground mt-8 max-w-3xl">
			Toate prețurile sunt pentru management și sunt exprimate în EUR, fără TVA. Bugetul media (Ads)
			și costul platformelor externe (Brevo, Mailchimp, HubSpot etc.) se plătesc separat, direct
			către furnizor.
		</p>
	</main>

	<footer class="border-t mt-10">
		<div
			class="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm"
		>
			<div class="text-muted-foreground">
				© {currentYear}
				{company?.name ?? 'One Top Solution'}
			</div>
			<div class="flex flex-wrap items-center gap-5">
				{#if company?.email}
					<a class="inline-flex items-center gap-1.5 hover:underline" href="mailto:{company.email}">
						<MailIcon class="h-4 w-4" />
						{company.email}
					</a>
				{/if}
				{#if company?.phone}
					<a
						class="inline-flex items-center gap-1.5 hover:underline"
						href="tel:{company.phone.replace(/\s+/g, '')}"
					>
						<PhoneIcon class="h-4 w-4" />
						{company.phone}
					</a>
				{/if}
			</div>
		</div>
	</footer>
</div>

<PackageComparisonView
	bind:open={compareOpen}
	category={selectedCategory}
	tiers={catalog.tiers}
	tierLabels={catalog.tierLabels}
	tierColors={catalog.tierColors}
	setupDefaultDescription={catalog.setupDefaultDescription}
	hourlyRates={catalog.hourlyRates}
	{isWebDev}
	onRequest={handleRequest}
	requestLabel={'Cere ofertă {tier}'}
/>

{#key requestSeq}
	<RequestQuoteDialog
		bind:open={requestOpen}
		category={requestCategory}
		tier={requestTier}
		tierLabels={catalog.tierLabels}
		tierColors={catalog.tierColors}
	/>
{/key}
