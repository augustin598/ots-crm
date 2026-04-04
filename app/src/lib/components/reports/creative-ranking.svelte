<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { formatCurrency, formatNumber, formatPercent, type AdAggregate } from '$lib/utils/report-helpers';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	let {
		ads,
		currency = 'RON',
		metric = 'ctr'
	}: {
		ads: AdAggregate[];
		currency?: string;
		metric?: 'ctr' | 'cpc' | 'conversions' | 'roas' | 'spend';
	} = $props();

	const METRICS: Record<string, { label: string; getValue: (a: AdAggregate) => number; format: (v: number) => string; higherIsBetter: boolean }> = {
		ctr: { label: 'CTR', getValue: a => a.ctr, format: v => formatPercent(v), higherIsBetter: true },
		cpc: { label: 'CPC', getValue: a => a.cpc, format: v => formatCurrency(v, currency), higherIsBetter: false },
		conversions: { label: 'Conversii', getValue: a => a.conversions, format: v => formatNumber(v), higherIsBetter: true },
		roas: { label: 'ROAS', getValue: a => a.roas, format: v => v > 0 ? `${v.toFixed(2)}x` : '-', higherIsBetter: true },
		spend: { label: 'Cheltuieli', getValue: a => a.spend, format: v => formatCurrency(v, currency), higherIsBetter: false }
	};

	const currentMetric = $derived(METRICS[metric] || METRICS.ctr);

	// Only include ads with meaningful data
	const rankedAds = $derived.by(() => {
		const withData = ads.filter(a => a.impressions > 0 && a.spend > 0);
		return [...withData].sort((a, b) => {
			const av = currentMetric.getValue(a);
			const bv = currentMetric.getValue(b);
			return currentMetric.higherIsBetter ? bv - av : av - bv;
		});
	});

	const topAds = $derived(rankedAds.slice(0, 5));
	const bottomAds = $derived(rankedAds.length > 5 ? rankedAds.slice(-3).reverse() : []);
</script>

{#if rankedAds.length > 0}
	<Card class="p-4">
		<div class="flex items-center justify-between mb-4">
			<h3 class="text-lg font-semibold">Creative Performance</h3>
			<select
				class="h-8 rounded-md border border-input bg-background px-2 text-sm"
				value={metric}
				onchange={(e) => { metric = e.currentTarget.value as typeof metric; }}
			>
				{#each Object.entries(METRICS) as [key, m]}
					<option value={key}>{m.label}</option>
				{/each}
			</select>
		</div>

		<!-- Top performers -->
		<div class="space-y-2 mb-4">
			<p class="text-xs font-semibold text-green-600 flex items-center gap-1"><TrendingUpIcon class="h-3 w-3" /> Top performeri</p>
			{#each topAds as ad, i}
				<div class="flex items-center gap-3 p-2 rounded-lg bg-green-50/50 dark:bg-green-900/10">
					<span class="text-sm font-bold text-muted-foreground w-5 text-center">{i + 1}</span>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium truncate" title={ad.adName}>{ad.adName}</p>
						<div class="flex gap-3 text-xs text-muted-foreground">
							<span>{formatCurrency(ad.spend, currency)} spend</span>
							<span>{formatNumber(ad.impressions)} impr.</span>
							<span>CTR {formatPercent(ad.ctr)}</span>
						</div>
					</div>
					<div class="text-right shrink-0">
						<p class="text-sm font-bold">{currentMetric.format(currentMetric.getValue(ad))}</p>
						<p class="text-[10px] text-muted-foreground">{currentMetric.label}</p>
					</div>
					{#if ad.previewUrl}
						<a href={ad.previewUrl} target="_blank" rel="noopener" class="text-muted-foreground hover:text-primary shrink-0">
							<ExternalLinkIcon class="h-3.5 w-3.5" />
						</a>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Bottom performers -->
		{#if bottomAds.length > 0}
			<div class="space-y-2">
				<p class="text-xs font-semibold text-red-600 flex items-center gap-1"><TrendingDownIcon class="h-3 w-3" /> Necesită atenție</p>
				{#each bottomAds as ad, i}
					<div class="flex items-center gap-3 p-2 rounded-lg bg-red-50/50 dark:bg-red-900/10">
						<span class="text-sm font-bold text-muted-foreground w-5 text-center">{rankedAds.length - bottomAds.length + i + 1}</span>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium truncate" title={ad.adName}>{ad.adName}</p>
							<div class="flex gap-3 text-xs text-muted-foreground">
								<span>{formatCurrency(ad.spend, currency)} spend</span>
								<span>{formatNumber(ad.impressions)} impr.</span>
							</div>
						</div>
						<div class="text-right shrink-0">
							<p class="text-sm font-bold text-red-600">{currentMetric.format(currentMetric.getValue(ad))}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</Card>
{/if}
