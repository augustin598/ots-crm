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
	import MinusIcon from '@lucide/svelte/icons/minus';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import {
		TIERS,
		TIER_LABELS,
		TIER_COLORS,
		SETUP_DEFAULT_DESCRIPTION,
		HOURLY_RATES,
		WEB_DEV_SLUGS,
		formatFeatureValue,
		isBooleanFeature,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';

	type Props = {
		open: boolean;
		category: Category | null;
		onRequest?: (tier: Tier) => void;
	};

	let { open = $bindable(), category, onRequest }: Props = $props();

	const isWebDev = $derived(category ? WEB_DEV_SLUGS.has(category.slug) : false);

	function formatEur(value: number | null): string {
		if (value === null) return '—';
		return `${value.toLocaleString('ro-RO')} €`;
	}
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

			<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 my-6">
				{#each TIERS as tier (tier)}
					{@const colors = TIER_COLORS[tier]}
					{@const price = category.prices[tier]}
					{@const setup = category.setupFees?.[tier]}
					{@const isRecommended = isWebDev && tier === 'silver'}
					<div
						class="relative rounded-xl border {isRecommended
							? 'border-primary ring-2 ring-primary/30'
							: colors.border} {colors.metallic} p-5 flex flex-col shadow-md overflow-hidden"
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
							class="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/50 to-transparent dark:from-white/10"
						></div>
						<div class="relative">
						<div class="flex items-center gap-2 mb-3">
							<span class="h-2.5 w-2.5 rounded-full {colors.dot}"></span>
							<span class="font-semibold {colors.text}">{TIER_LABELS[tier]}</span>
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
										{category.setupDescription || SETUP_DEFAULT_DESCRIPTION}
									</p>
								</PopoverContent>
							</Popover>
						{/if}
						{#if onRequest}
							<Button
								class="mt-4 w-full"
								size="sm"
								onclick={() => onRequest(tier)}
								disabled={price === null && !setup}
							>
								Vreau {TIER_LABELS[tier]}
							</Button>
						{/if}
						</div>
					</div>
				{/each}
			</div>

			{#if category.priceNote}
				<p class="text-sm text-muted-foreground italic mb-4">{category.priceNote}</p>
			{/if}

			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="bg-muted/50">
						<tr>
							<th class="text-left p-3 font-medium">Funcționalitate</th>
							{#each TIERS as tier (tier)}
								{@const colors = TIER_COLORS[tier]}
								<th class="p-3 font-semibold text-center {colors.text}">
									<div class="inline-flex items-center gap-1.5">
										<span class="h-2 w-2 rounded-full {colors.dot}"></span>
										{TIER_LABELS[tier]}
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each category.features as feature (feature.id)}
							<tr class="border-t">
								<td class="p-3 align-top">{feature.label}</td>
								{#each TIERS as tier (tier)}
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
						Pentru modificări sau funcționalități peste scope-ul pachetului fixed-price,
						facturăm pe oră după specializare:
					</p>
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
						{#each HOURLY_RATES as rate (rate.label)}
							<div class="rounded-md bg-background border p-3 text-center">
								<div class="text-xs text-muted-foreground mb-0.5">{rate.label}</div>
								<div class="text-lg font-bold">{rate.rate} €<span class="text-xs font-normal text-muted-foreground">/h</span></div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</DialogContent>
</Dialog>
