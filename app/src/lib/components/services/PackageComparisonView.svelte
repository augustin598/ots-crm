<!--
	Dialogul de comparație a pachetelor (Bronze → Platinum) pentru o categorie.

	Primește TOATE datele prin props — nu importă `$lib/constants/ots-catalog` —
	ca pagina publică `/servicii` să poată reda catalogul fără ca prețurile să
	ajungă în bundle-ul de client al vizitatorilor care n-au introdus parola.

	Consumatori:
	  - [tenant]/services/PackageComparisonDialog.svelte (wrapper cu constantele importate)
	  - routes/servicii (catalog public, date primite de la server)
-->
<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { formatEur, formatFeatureValue, isBooleanFeature } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier, TierColors } from '$lib/constants/ots-catalog';
	import CategoryIcon from './CategoryIcon.svelte';

	type Props = {
		open: boolean;
		category: Category | null;
		tiers: Tier[];
		tierLabels: Record<Tier, string>;
		tierColors: Record<Tier, TierColors>;
		setupDefaultDescription: string;
		hourlyRates: { label: string; rate: number }[];
		/** Categoriile de web dev primesc badge „Recomandat" pe Silver + tarife orare. */
		isWebDev?: boolean;
		onRequest?: (tier: Tier) => void;
		/** Textul butonului de cerere; `{tier}` e înlocuit cu numele pachetului. */
		requestLabel?: string;
		/** Tier-ul deja ales pentru această categorie (coșul de pe /servicii); butonul lui arată `activeLabel`. */
		activeTier?: Tier | null;
		activeLabel?: string;
	};

	let {
		open = $bindable(),
		category,
		tiers,
		tierLabels,
		tierColors,
		setupDefaultDescription,
		hourlyRates,
		isWebDev = false,
		onRequest,
		requestLabel = 'Vreau {tier}',
		activeTier = null,
		activeLabel = 'În ofertă'
	}: Props = $props();
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
		{#if category}
			<DialogHeader>
				<div class="flex items-center gap-3">
					<div class="rounded-lg bg-muted/60 p-2.5 shrink-0">
						<CategoryIcon slug={category.slug} class="h-6 w-6" />
					</div>
					<div class="min-w-0">
						<DialogTitle class="text-2xl leading-tight">{category.name}</DialogTitle>
						<DialogDescription>{category.tagline}</DialogDescription>
					</div>
				</div>
			</DialogHeader>

			<!-- Pe telefon o singură coloană: la două, prețurile („1.200 €/lună") și butoanele se rupeau pe rânduri. -->
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-6">
				{#each tiers as tier (tier)}
					{@const colors = tierColors[tier]}
					{@const price = category.prices[tier]}
					{@const setup = category.setupFees?.[tier]}
					{@const isRecommended = isWebDev && tier === 'silver'}
					<div
						class="relative rounded-xl border {isRecommended
							? 'border-primary ring-2 ring-primary/30'
							: colors.border} {colors.metallic} p-5 flex flex-col shadow-md"
					>
						{#if isRecommended}
							<span
								class="absolute -top-2.5 right-4 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary text-primary-foreground shadow-sm z-10"
							>
								<CheckIcon class="h-2.5 w-2.5" />
								Recomandat OTS
							</span>
						{/if}
						<div
							class="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
						></div>
						<div class="relative">
							<div class="flex items-center gap-2 mb-3">
								<span class="h-2.5 w-2.5 rounded-full {colors.dot}"></span>
								<span class="font-semibold {colors.text}">{tierLabels[tier]}</span>
							</div>
							<div class="text-2xl font-bold {colors.text}">
								{#if price !== null}
									{formatEur(price)}
									<span class="text-sm font-normal opacity-70">/lună</span>
								{:else if setup}
									{formatEur(setup)}
									<span class="text-sm font-normal opacity-70">one-time</span>
								{:else}
									<span class="opacity-50">—</span>
								{/if}
							</div>
							{#if setup && price !== null}
								<Popover>
									<PopoverTrigger
										class="inline-flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
									>
										Setup: <strong>{formatEur(setup)}</strong>
										<HelpCircleIcon class="h-3 w-3 opacity-70" />
									</PopoverTrigger>
									<PopoverContent class="max-w-[320px] p-3">
										<p class="font-semibold text-sm mb-1.5">Ce include setup-ul?</p>
										<p class="text-[13px] text-foreground/90 leading-relaxed">
											{category.setupDescription || setupDefaultDescription}
										</p>
									</PopoverContent>
								</Popover>
							{/if}
							{#if onRequest}
								{@const isActive = activeTier === tier}
								<!-- Toggle: a doua apăsare scoate serviciul din ofertă; numele spune asta, nu doar starea. -->
								<Button
									class={cn('mt-4 w-full', isActive && 'border-primary text-primary')}
									size="sm"
									variant={isActive ? 'outline' : 'default'}
									aria-pressed={isActive}
									aria-label={isActive
										? `${activeLabel}: ${tierLabels[tier]} — apasă pentru a scoate din ofertă`
										: undefined}
									onclick={() => onRequest(tier)}
									disabled={price === null && !setup}
								>
									{#if isActive}
										<CheckIcon class="h-3.5 w-3.5" aria-hidden="true" />
										{activeLabel}
									{:else}
										{requestLabel.replace('{tier}', tierLabels[tier])}
									{/if}
								</Button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			{#if category.priceNote}
				<p class="text-sm text-muted-foreground italic mb-4">{category.priceNote}</p>
			{/if}

			<!-- Pe telefon tabelul derulează orizontal, cu coloana de funcționalități fixă în stânga. -->
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full min-w-[540px] sm:min-w-0 text-sm">
					<thead class="bg-muted/50">
						<tr>
							<th class="sticky left-0 z-10 w-[150px] bg-muted text-left p-3 font-medium sm:static sm:w-auto sm:bg-transparent">Funcționalitate</th>
							{#each tiers as tier (tier)}
								{@const colors = tierColors[tier]}
								<th class="p-3 font-semibold text-center {colors.text}">
									<div class="inline-flex items-center gap-1.5">
										<span class="h-2 w-2 rounded-full {colors.dot}"></span>
										{tierLabels[tier]}
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each category.features as feature (feature.id)}
							<tr class="border-t">
								<td class="sticky left-0 z-10 bg-background p-3 align-top sm:static sm:bg-transparent">{feature.label}</td>
								{#each tiers as tier (tier)}
									{@const value = feature.values[tier]}
									<td class="p-3 text-center align-top">
										{#if isBooleanFeature(value)}
											{#if value}
												<CheckIcon class="mx-auto h-4 w-4 text-green-600 dark:text-green-400" />
											{:else}
												<MinusIcon class="mx-auto h-4 w-4 text-muted-foreground/40" />
											{/if}
										{:else}
											<span class="font-medium">{formatFeatureValue(value)}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if category.notes && category.notes.length > 0}
				<div class="mt-4 space-y-1">
					{#each category.notes as note (note)}
						<p class="text-xs text-muted-foreground">{note}</p>
					{/each}
				</div>
			{/if}

			<div class="mt-4 text-xs text-muted-foreground flex items-center gap-2">
				<Badge variant="outline" class="text-[10px]">EUR fără TVA</Badge>
				<span>Bugetul media (Ads) se plătește separat direct către platformă.</span>
			</div>

			{#if isWebDev}
				<section class="mt-6 rounded-lg border bg-muted/30 p-4">
					<div class="flex items-center gap-2 mb-3">
						<h4 class="text-sm font-semibold">Extra work peste scope</h4>
						<Badge variant="outline" class="text-[10px]">Tarife orare</Badge>
					</div>
					<p class="text-xs text-muted-foreground mb-3">
						Pentru modificări sau funcționalități peste scope-ul pachetului fixed-price, facturăm pe
						oră după specializare:
					</p>
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
						{#each hourlyRates as rate (rate.label)}
							<div class="rounded-md bg-background border p-3 text-center">
								<div class="text-xs text-muted-foreground mb-0.5">{rate.label}</div>
								<div class="text-lg font-bold">
									{rate.rate} €<span class="text-xs font-normal text-muted-foreground">/h</span>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</DialogContent>
</Dialog>
