<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { FunnelAnalysis } from '$lib/utils/advanced-kpi';

	let { analysis }: { analysis: FunnelAnalysis } = $props();

	const formatNum = (v: number) => new Intl.NumberFormat('ro-RO').format(Math.round(v));

	const maxValue = $derived(analysis.steps.length > 0 ? analysis.steps[0].value : 1);
</script>

<Card class="p-4">
	<h3 class="text-sm font-semibold mb-3">Funnel de conversie</h3>

	{#if analysis.steps.length === 0}
		<p class="text-sm text-muted-foreground">Fără date</p>
	{:else}
		<div class="space-y-2">
			{#each analysis.steps as step, i (step.label)}
				{@const widthPct = maxValue > 0 ? Math.max(5, (step.value / maxValue) * 100) : 5}
				{@const isWorst = i > 0 && step.label === analysis.worstStep}
				<div>
					<div class="flex items-center justify-between text-xs mb-0.5">
						<span class="font-medium {isWorst ? 'text-red-600 dark:text-red-400' : ''}">{step.label}</span>
						<span class="text-muted-foreground">
							{formatNum(step.value)}
							{#if i > 0}
								<span class={isWorst ? 'text-red-600 dark:text-red-400 font-semibold' : ''}
									>({step.rate.toFixed(1)}%)</span>
							{/if}
						</span>
					</div>
					<div class="h-6 rounded bg-muted overflow-hidden">
						<div
							class="h-full rounded transition-all {isWorst ? 'bg-red-500/80' : 'bg-primary/70'}"
							style="width: {widthPct}%"
						></div>
					</div>
					{#if i > 0 && step.dropOff > 0}
						<p class="text-[10px] text-muted-foreground mt-0.5 {isWorst ? 'text-red-500 dark:text-red-400 font-medium' : ''}">
							Drop-off: -{step.dropOff.toFixed(1)}%
							{#if isWorst} (cea mai mare pierdere){/if}
						</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</Card>
