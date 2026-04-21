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
	import {
		Tooltip,
		TooltipContent,
		TooltipProvider,
		TooltipTrigger
	} from '$lib/components/ui/tooltip';
	import {
		TIERS,
		TIER_LABELS,
		TIER_COLORS,
		SETUP_DEFAULT_DESCRIPTION,
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
					<div
						class="relative rounded-xl border {colors.border} {colors.metallic} p-5 flex flex-col shadow-md overflow-hidden"
					>
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
							<TooltipProvider delayDuration={150}>
								<Tooltip>
									<TooltipTrigger
										tabindex={-1}
										class="inline-flex items-center gap-1 mt-1.5 text-xs text-muted-foreground cursor-help"
									>
										Setup: <strong>{formatEur(setup)}</strong>
										<HelpCircleIcon class="h-3 w-3 opacity-70" />
									</TooltipTrigger>
									<TooltipContent
										class="max-w-[320px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
										arrowClasses="!bg-popover"
									>
										<p class="font-semibold text-sm mb-1.5 text-foreground">Ce include setup-ul?</p>
										<p class="text-[13px] text-foreground/90 leading-relaxed">
											{category.setupDescription || SETUP_DEFAULT_DESCRIPTION}
										</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
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
		{/if}
	</DialogContent>
</Dialog>
