<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { formatNumber, formatPercent } from '$lib/utils/report-helpers';

	let {
		impressions = 0,
		clicks = 0,
		linkClicks = 0,
		landingPageViews = 0,
		conversions = 0
	}: {
		impressions?: number;
		clicks?: number;
		linkClicks?: number;
		landingPageViews?: number;
		conversions?: number;
	} = $props();

	const steps = $derived.by(() => {
		const raw = [
			{ label: 'Impresii', value: impressions, color: 'bg-blue-500' },
			{ label: 'Click-uri', value: clicks, color: 'bg-cyan-500' },
			{ label: 'Link clicks', value: linkClicks, color: 'bg-teal-500' },
			{ label: 'Landing page views', value: landingPageViews, color: 'bg-emerald-500' },
			{ label: 'Conversii', value: conversions, color: 'bg-green-500' }
		].filter(s => s.value > 0);

		if (raw.length < 2) return [];

		const maxVal = raw[0].value;
		return raw.map((step, i) => {
			const widthPct = maxVal > 0 ? Math.max((step.value / maxVal) * 100, 8) : 0;
			const prevValue = i > 0 ? raw[i - 1].value : step.value;
			const dropOff = prevValue > 0 ? ((prevValue - step.value) / prevValue) * 100 : 0;
			const convRate = prevValue > 0 && i > 0 ? (step.value / prevValue) * 100 : 100;
			return { ...step, widthPct, dropOff, convRate, isFirst: i === 0 };
		});
	});
</script>

{#if steps.length >= 2}
	<Card class="p-4">
		<h3 class="text-lg font-semibold mb-4">Funnel de conversie</h3>
		<div class="space-y-2">
			{#each steps as step, i}
				<div class="flex items-center gap-3">
					<!-- Label -->
					<div class="w-[130px] text-right shrink-0">
						<p class="text-sm font-medium">{step.label}</p>
						<p class="text-xs text-muted-foreground">{formatNumber(step.value)}</p>
					</div>
					<!-- Bar -->
					<div class="flex-1 relative">
						<div class="h-10 rounded-md {step.color} transition-all duration-500 flex items-center justify-end pr-3"
							style="width: {step.widthPct}%; min-width: 60px;">
							{#if !step.isFirst}
								<span class="text-white text-xs font-semibold drop-shadow">
									{step.convRate.toFixed(1)}%
								</span>
							{/if}
						</div>
					</div>
					<!-- Drop-off indicator -->
					<div class="w-[70px] shrink-0 text-right">
						{#if !step.isFirst && step.dropOff > 0}
							<span class="text-xs text-red-500 font-medium">-{step.dropOff.toFixed(1)}%</span>
						{:else if step.isFirst}
							<span class="text-xs text-muted-foreground">100%</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		<!-- Overall conversion rate -->
		{#if steps.length >= 2}
			{@const overall = steps[0].value > 0 ? (steps[steps.length - 1].value / steps[0].value) * 100 : 0}
			<div class="mt-4 pt-3 border-t flex items-center justify-between">
				<span class="text-sm text-muted-foreground">Rată de conversie totală</span>
				<span class="text-sm font-bold {overall > 1 ? 'text-green-600' : 'text-amber-600'}">{overall.toFixed(2)}%</span>
			</div>
		{/if}
	</Card>
{/if}
