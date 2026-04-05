<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { SaturationMatrix, SaturationQuadrant } from '$lib/utils/advanced-kpi';

	let { matrix }: { matrix: SaturationMatrix } = $props();

	const QUADRANT_COLORS: Record<SaturationQuadrant, string> = {
		scale: 'bg-green-600 dark:bg-green-500',
		optimize: 'bg-sky-600 dark:bg-sky-400',
		refresh: 'bg-amber-500 dark:bg-amber-400',
		pause: 'bg-red-600 dark:bg-red-500'
	};

	const QUADRANT_LABELS: Record<SaturationQuadrant, string> = {
		scale: 'Scale',
		optimize: 'Optimizează',
		refresh: 'Refresh',
		pause: 'Pauză'
	};

	const QUADRANT_BG: Record<SaturationQuadrant, string> = {
		scale: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800',
		optimize: 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800',
		refresh: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
		pause: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
	};

	const sorted = $derived([...matrix.points].sort((a, b) => b.spend - a.spend));

	const OBJECTIVE_CATEGORY: Record<string, string> = {
		OUTCOME_SALES: 'sales', CONVERSIONS: 'sales',
		OUTCOME_LEADS: 'leads', LEAD_GENERATION: 'leads',
		OUTCOME_TRAFFIC: 'traffic', LINK_CLICKS: 'traffic',
		OUTCOME_ENGAGEMENT: 'engagement', POST_ENGAGEMENT: 'engagement', MESSAGES: 'engagement',
		OUTCOME_AWARENESS: 'awareness', REACH: 'awareness', BRAND_AWARENESS: 'awareness', VIDEO_VIEWS: 'awareness',
		OUTCOME_APP_PROMOTION: 'traffic', APP_INSTALLS: 'traffic'
	};

	function ipeExplanation(point: typeof matrix.points[0], good: boolean): string {
		const cat = OBJECTIVE_CATEGORY[point.objective] || 'traffic';
		if (good) {
			switch (cat) {
				case 'sales': return `ROAS ${point.roas.toFixed(1)}x bun, CPM eficient`;
				case 'leads': return `CPL ${point.costPerConversion.toFixed(0)} RON eficient, volum bun`;
				case 'traffic': return `CPC și CTR ${point.ctr.toFixed(2)}% bune`;
				case 'engagement': return `cost per engagement ok, CTR ${point.ctr.toFixed(2)}% bun`;
				case 'awareness': return `CPM ${point.cpm.toFixed(0)} RON eficient, reach bun`;
				default: return 'metrici bune';
			}
		}
		switch (cat) {
			case 'sales': return `ROAS ${point.roas.toFixed(1)}x și CPM necesită optimizare`;
			case 'leads': return `CPL ${point.costPerConversion.toFixed(0)} RON — optimizează formularul sau audiența`;
			case 'traffic': return `CTR ${point.ctr.toFixed(2)}% și CPM ${point.cpm.toFixed(0)} RON necesită optimizare`;
			case 'engagement': return `CTR ${point.ctr.toFixed(2)}% și CPM necesită optimizare`;
			case 'awareness': return `CPM ${point.cpm.toFixed(0)} RON — verifică targetarea`;
			default: return `CTR ${point.ctr.toFixed(2)}% și CPM necesită optimizare`;
		}
	}
</script>

<Card class="p-4">
	<h3 class="text-sm font-semibold mb-1">Analiză detaliată per campanie</h3>
	<p class="text-xs text-muted-foreground mb-3">IPE = Index Performanță · ISC = Index Saturație · Recomandare personalizată</p>

	{#if sorted.length === 0}
		<p class="text-sm text-muted-foreground">Fără date suficiente</p>
	{:else}
		<div class="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
			{#each sorted as point (point.campaignId)}
				{@const ipeLabel = point.ipe >= 50 ? 'bună' : 'sub medie'}
				{@const iscLabel = point.isc >= 50 ? 'saturată' : 'fresh'}
				<div class="rounded-lg border {QUADRANT_BG[point.quadrant]} p-3 space-y-2">
					<!-- Header: campaign name + quadrant -->
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-1.5 min-w-0">
							<div class="w-3 h-3 rounded-full {QUADRANT_COLORS[point.quadrant]} shrink-0"></div>
							<span class="text-xs font-semibold truncate" title={point.campaignName}>{point.campaignName}</span>
						</div>
						<span class="text-[10px] font-medium shrink-0 rounded-full px-2 py-0.5 {QUADRANT_BG[point.quadrant]}">{QUADRANT_LABELS[point.quadrant]}</span>
					</div>

					<!-- IPE + ISC side by side -->
					<div class="grid grid-cols-2 gap-2">
						<div class="rounded-md bg-background/80 px-2.5 py-1.5">
							<div class="flex items-center justify-between">
								<span class="text-[10px] font-medium text-muted-foreground">IPE</span>
								<span class="text-sm font-bold {point.ipe >= 50 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">{point.ipe.toFixed(0)}</span>
							</div>
							<p class="text-[10px] text-muted-foreground leading-snug mt-0.5">
								Performanță {ipeLabel} — {ipeExplanation(point, point.ipe >= 50)}
							</p>
						</div>
						<div class="rounded-md bg-background/80 px-2.5 py-1.5">
							<div class="flex items-center justify-between">
								<span class="text-[10px] font-medium text-muted-foreground">ISC</span>
								<span class="text-sm font-bold {point.isc < 50 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}">{point.isc.toFixed(0)}</span>
							</div>
							<p class="text-[10px] text-muted-foreground leading-snug mt-0.5">
								Audiență {iscLabel} — {point.isc < 50 ? 'frequency ok, spațiu de creștere' : 'frequency și CPM ridicate'}
							</p>
						</div>
					</div>

					<!-- Recommendation -->
					<p class="text-[11px] font-medium text-primary leading-snug">{point.recommendation}</p>
				</div>
			{/each}
		</div>
	{/if}
</Card>
