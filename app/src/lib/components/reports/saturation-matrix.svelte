<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { SaturationMatrix, SaturationQuadrant } from '$lib/utils/advanced-kpi';

	let { matrix }: { matrix: SaturationMatrix } = $props();

	const QUADRANT_COLORS: Record<SaturationQuadrant, string> = {
		scale: 'bg-green-600 dark:bg-green-500',
		optimize: 'bg-sky-600 dark:bg-sky-400',
		refresh: 'bg-amber-500 dark:bg-amber-400',
		pause: 'bg-red-600 dark:bg-red-500'
	};

	const QUADRANT_RING: Record<SaturationQuadrant, string> = {
		scale: 'ring-green-300 dark:ring-green-700',
		optimize: 'ring-sky-300 dark:ring-sky-700',
		refresh: 'ring-amber-300 dark:ring-amber-700',
		pause: 'ring-red-300 dark:ring-red-700'
	};

	const QUADRANT_LABELS: Record<SaturationQuadrant, string> = {
		scale: 'Scale',
		optimize: 'Optimizează',
		refresh: 'Refresh',
		pause: 'Pauză'
	};

	const QUADRANT_DESC: Record<SaturationQuadrant, string> = {
		scale: 'Performanță bună, audiență fresh — crește bugetul',
		optimize: 'Performanță slabă, audiență fresh — testează alt creative/copy',
		refresh: 'Performanță bună, audiență obosită — rotește creative-urile',
		pause: 'Performanță slabă, audiență saturată — oprește sau resetează'
	};
</script>

<Card class="p-4">
	<h3 class="text-sm font-semibold mb-1">Matricea de saturație</h3>
	<p class="text-xs text-muted-foreground mb-3">Performanță vs Saturație — unde să investești</p>

	{#if matrix.points.length === 0}
		<p class="text-sm text-muted-foreground">Fără date suficiente</p>
	{:else}
		<div class="relative w-full aspect-square border rounded-lg bg-muted/30 overflow-hidden">
			<!-- Quadrant backgrounds: X=ISC (saturație), Y=IPE (performanță) -->
			<div class="absolute inset-0 grid grid-cols-2 grid-rows-2">
				<!-- Top-left: high perf, low sat = SCALE -->
				<div class="bg-green-50/50 dark:bg-green-900/10 border-r border-b flex items-center justify-center">
					<span class="text-[10px] text-green-600 dark:text-green-400 font-medium">Scale</span>
				</div>
				<!-- Top-right: high perf, high sat = REFRESH -->
				<div class="bg-amber-50/50 dark:bg-amber-900/10 border-b flex items-center justify-center">
					<span class="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Refresh</span>
				</div>
				<!-- Bottom-left: low perf, low sat = OPTIMIZE -->
				<div class="bg-blue-50/50 dark:bg-blue-900/10 border-r flex items-center justify-center">
					<span class="text-[10px] text-blue-600 dark:text-blue-400 font-medium">Optimizează</span>
				</div>
				<!-- Bottom-right: low perf, high sat = PAUSE -->
				<div class="bg-red-50/50 dark:bg-red-900/10 flex items-center justify-center">
					<span class="text-[10px] text-red-600 dark:text-red-400 font-medium">Pauză</span>
				</div>
			</div>

			<!-- Data points positioned by ISC (x) and IPE (y) -->
			{#each matrix.points as point}
				{@const x = Math.min(92, Math.max(8, point.isc * 0.84 + 8))}
				{@const y = Math.min(92, Math.max(8, 92 - point.ipe * 0.84))}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								class="absolute rounded-full {QUADRANT_COLORS[point.quadrant]} {QUADRANT_RING[point.quadrant]} {point.lowData ? 'opacity-40' : 'opacity-90'} hover:opacity-100 hover:scale-150 transition-all cursor-default ring-3 shadow-md min-w-[20px] min-h-[20px] w-[20px] h-[20px]"
								style="left: {x}%; top: {y}%; transform: translate(-50%, -50%)"
							></button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="top" sideOffset={8} class="bg-popover text-popover-foreground border shadow-lg max-w-xs">
						<div class="text-xs space-y-1.5">
							<p class="font-semibold truncate">{point.campaignName}</p>
							<div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
								<span class="text-muted-foreground">IPE: <strong class="text-popover-foreground">{point.ipe.toFixed(0)}</strong></span>
								<span class="text-muted-foreground">ISC: <strong class="text-popover-foreground">{point.isc.toFixed(0)}</strong></span>
								<span class="text-muted-foreground">ROAS: <strong class="text-popover-foreground">{point.roas > 0 ? point.roas.toFixed(1) + 'x' : '—'}</strong></span>
								<span class="text-muted-foreground">CTR: <strong class="text-popover-foreground">{point.ctr.toFixed(2)}%</strong></span>
								<span class="text-muted-foreground">Freq: <strong class="text-popover-foreground">{point.frequency.toFixed(1)}</strong></span>
								<span class="text-muted-foreground">CPM: <strong class="text-popover-foreground">{point.cpm.toFixed(0)} RON</strong></span>
							</div>
							<p class="font-medium pt-0.5 border-t border-border mt-1 pt-1">{point.recommendation}</p>
						</div>
					</Tooltip.Content>
				</Tooltip.Root>
			{/each}

			<!-- Axis labels -->
			<div class="absolute bottom-0 left-0 right-0 text-center">
				<span class="text-[10px] text-muted-foreground">Index Saturație →</span>
			</div>
			<div class="absolute top-1/2 left-1 -translate-y-1/2 -rotate-90">
				<span class="text-[10px] text-muted-foreground">Performanță ↑</span>
			</div>
		</div>

		<!-- Legend with descriptions -->
		<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
			{#each (['scale', 'refresh', 'optimize', 'pause'] as const) as q}
				{@const count = matrix.points.filter((p) => p.quadrant === q).length}
				<div class="flex items-start gap-1.5">
					<div class="w-2.5 h-2.5 rounded-full {QUADRANT_COLORS[q]} shrink-0 mt-0.5"></div>
					<div>
						<span class="text-[11px] font-medium">{QUADRANT_LABELS[q]} ({count})</span>
						<p class="text-[10px] text-muted-foreground leading-tight">{QUADRANT_DESC[q]}</p>
					</div>
				</div>
			{/each}
		</div>

	{/if}
</Card>
