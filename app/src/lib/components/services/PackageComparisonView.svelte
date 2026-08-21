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
	import { dragScroll } from '$lib/actions/drag-scroll';
	import FeatureHint from './FeatureHint.svelte';
	import { FEATURE_HINTS } from '$lib/constants/ots-catalog-feature-hints';
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
	<!-- Suprafață albă: cardurile de tier au text închis pe alb (contrast), iar culoarea
	     tier-ului e doar accent (banda de sus, punctul, numele). -->
	<DialogContent class="sm:max-w-5xl max-h-[90vh] overflow-y-auto bg-white dark:bg-card p-6 sm:p-8">
		{#if category}
			<DialogHeader>
				<div class="flex items-center gap-3.5">
					<div class="rounded-xl bg-primary/10 text-primary p-3 shrink-0 ring-1 ring-primary/15">
						<CategoryIcon slug={category.slug} class="h-6 w-6" />
					</div>
					<div class="min-w-0">
						<DialogTitle class="text-2xl sm:text-[26px] font-extrabold tracking-tight leading-tight">
							{category.name}
						</DialogTitle>
						<DialogDescription class="text-[15px] mt-0.5">{category.tagline}</DialogDescription>
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
						class={cn(
							'relative overflow-hidden rounded-2xl border bg-white dark:bg-background flex flex-col shadow-sm transition-shadow hover:shadow-lg',
							isRecommended
								? 'border-primary ring-2 ring-primary/25 shadow-md'
								: 'border-border dark:border-border'
						)}
					>
						<!-- Banda de tier: singurul loc unde gradientul „metalic" mai apare. -->
						<div class="h-2 {colors.metallic}" aria-hidden="true"></div>
						{#if isRecommended}
							<span
								class="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary text-primary-foreground shadow-sm z-10"
							>
								<CheckIcon class="h-2.5 w-2.5" />
								Recomandat
							</span>
						{/if}
						<div class="relative p-5 pt-4 flex flex-col flex-1">
							<div class="flex items-center gap-2 mb-4">
								<span class="h-2.5 w-2.5 rounded-full {colors.dot} ring-4 ring-current/10"></span>
								<span class="text-[13px] font-bold uppercase tracking-wider {colors.text}">
									{tierLabels[tier]}
								</span>
							</div>
							<!-- Unitatea pe rândul ei: „18.000 € one-time" nu se mai rupe la mijloc pe cardul îngust. -->
							<div class="text-[28px] leading-none font-extrabold tracking-tight text-foreground whitespace-nowrap">
								{#if price !== null}
									{formatEur(price)}
								{:else if setup}
									{formatEur(setup)}
								{:else}
									<span class="text-muted-foreground/50">—</span>
								{/if}
							</div>
							<div class="mt-1.5 mb-4 text-[13px] font-medium text-muted-foreground">
								{#if price !== null}
									pe lună, fără TVA
								{:else if setup}
									plată unică, fără TVA
								{:else}
									&nbsp;
								{/if}
							</div>
							{#if setup && price !== null}
								<Popover>
									<PopoverTrigger
										class="-mt-2 mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
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
									class={cn(
										'mt-auto pt-0 w-full font-semibold',
										isActive ? 'border-primary text-primary bg-primary/5' : 'shadow-sm ots-gloss'
									)}
									size="sm"
									variant={isActive ? 'outline' : 'default'}
									aria-pressed={isActive}
									aria-label={isActive
										? `${activeLabel}: ${tierLabels[tier]}. Apasă pentru a-l scoate din ofertă`
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
				<p class="mb-4 rounded-lg bg-muted/40 px-3.5 py-2.5 text-[13px] text-muted-foreground">
					{category.priceNote}
				</p>
			{/if}

			<!-- Pe telefon tabelul derulează orizontal, cu coloana de funcționalități fixă în stânga. -->
			<div class="overflow-x-auto rounded-xl border bg-white dark:bg-background" {@attach dragScroll}>
				<table class="w-full min-w-[540px] sm:min-w-0 text-sm">
					<thead>
						<tr class="border-b-2 border-border">
							<th class="sticky left-0 z-10 w-[150px] bg-white dark:bg-background text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:static sm:w-auto">Funcționalitate</th>
							{#each tiers as tier (tier)}
								{@const colors = tierColors[tier]}
								<th class="px-3 py-3 font-bold text-center {colors.text}">
									<div class="inline-flex items-center gap-1.5">
										<span class="h-2 w-2 rounded-full {colors.dot}"></span>
										{tierLabels[tier]}
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each category.features as feature, i (feature.id)}
							<tr class={cn('border-t border-border/70', i % 2 === 1 && 'bg-muted/30')}>
								<td class={cn('sticky left-0 z-10 px-4 py-3 align-top font-medium text-foreground sm:static', i % 2 === 1 ? 'bg-muted/30 sm:bg-transparent' : 'bg-white dark:bg-background sm:bg-transparent')}>
									<span class="inline-flex items-center">
										{feature.label}
										{#if FEATURE_HINTS[feature.id]}
											<FeatureHint text={FEATURE_HINTS[feature.id]} label={feature.label} />
										{/if}
									</span>
								</td>
								{#each tiers as tier (tier)}
									{@const value = feature.values[tier]}
									<td class="px-3 py-3 text-center align-top">
										{#if isBooleanFeature(value)}
											{#if value}
												<span class="inline-grid h-6 w-6 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
													<CheckIcon class="h-3.5 w-3.5" />
												</span>
											{:else}
												<MinusIcon class="mx-auto h-4 w-4 text-muted-foreground/35" />
											{/if}
										{:else}
											<span class="font-semibold text-foreground">{formatFeatureValue(value)}</span>
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
