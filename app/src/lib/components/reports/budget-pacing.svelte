<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { formatCurrency, formatNumber } from '$lib/utils/report-helpers';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	let {
		totalSpend,
		totalDailyBudget,
		since,
		until,
		currency = 'RON'
	}: {
		totalSpend: number;
		totalDailyBudget: number;
		since: string;
		until: string;
		currency?: string;
	} = $props();

	// Calculate pacing metrics
	const pacing = $derived.by(() => {
		if (totalDailyBudget <= 0) return null;

		const sinceDate = new Date(since + 'T00:00:00');
		const untilDate = new Date(until + 'T00:00:00');
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const totalDays = Math.max(1, Math.round((untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
		const elapsedDays = Math.max(1, Math.round((Math.min(today.getTime(), untilDate.getTime()) - sinceDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
		const remainingDays = Math.max(0, totalDays - elapsedDays);

		// Monthly budget = daily budget * total days in period
		const periodBudget = totalDailyBudget * totalDays;
		const expectedSpend = totalDailyBudget * elapsedDays;

		// Daily average spend so far
		const dailyAvgSpend = totalSpend / elapsedDays;

		// Projected total spend for the period
		const projectedSpend = totalSpend + (dailyAvgSpend * remainingDays);

		// Pacing percentage (actual vs expected)
		const pacingPct = expectedSpend > 0 ? (totalSpend / expectedSpend) * 100 : 0;

		// Spend progress percentage
		const spendPct = periodBudget > 0 ? Math.min((totalSpend / periodBudget) * 100, 100) : 0;

		// Status
		let status: 'on-track' | 'underspend' | 'overspend';
		if (pacingPct >= 85 && pacingPct <= 115) status = 'on-track';
		else if (pacingPct < 85) status = 'underspend';
		else status = 'overspend';

		return {
			periodBudget,
			expectedSpend,
			dailyAvgSpend,
			projectedSpend,
			pacingPct,
			spendPct,
			status,
			totalDays,
			elapsedDays,
			remainingDays
		};
	});
</script>

{#if pacing}
	<Card class="p-4">
		<div class="flex items-center justify-between mb-3">
			<h3 class="text-sm font-semibold text-muted-foreground">Budget Pacing</h3>
			<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
				{pacing.status === 'on-track' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
				 pacing.status === 'underspend' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
				 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}">
				{#if pacing.status === 'on-track'}
					<TrendingUpIcon class="h-3 w-3" /> On Track
				{:else if pacing.status === 'underspend'}
					<TrendingDownIcon class="h-3 w-3" /> Underspend
				{:else}
					<AlertTriangleIcon class="h-3 w-3" /> Overspend
				{/if}
			</span>
		</div>

		<!-- Progress bar -->
		<div class="relative h-3 w-full rounded-full bg-muted overflow-hidden mb-2">
			<div
				class="absolute inset-y-0 left-0 rounded-full transition-all duration-500
					{pacing.status === 'on-track' ? 'bg-green-500' :
					 pacing.status === 'underspend' ? 'bg-amber-500' : 'bg-red-500'}"
				style="width: {pacing.spendPct}%"
			></div>
			<!-- Expected spend marker -->
			<div
				class="absolute inset-y-0 w-0.5 bg-foreground/40"
				style="left: {pacing.periodBudget > 0 ? Math.min((pacing.expectedSpend / pacing.periodBudget) * 100, 100) : 0}%"
				title="Cheltuieli așteptate: {formatCurrency(pacing.expectedSpend, currency)}"
			></div>
		</div>

		<!-- Numbers -->
		<div class="flex items-center justify-between text-xs text-muted-foreground mb-3">
			<span>{formatCurrency(totalSpend, currency)} cheltuit</span>
			<span>{formatCurrency(pacing.periodBudget, currency)} buget</span>
		</div>

		<!-- Metrics grid -->
		<div class="grid grid-cols-3 gap-3 text-center">
			<div>
				<p class="text-lg font-bold">{pacing.pacingPct.toFixed(0)}%</p>
				<p class="text-[10px] text-muted-foreground">Pacing</p>
			</div>
			<div>
				<p class="text-lg font-bold">{formatCurrency(pacing.dailyAvgSpend, currency)}</p>
				<p class="text-[10px] text-muted-foreground">Media/zi</p>
			</div>
			<div>
				<p class="text-lg font-bold">{formatCurrency(pacing.projectedSpend, currency)}</p>
				<p class="text-[10px] text-muted-foreground">Proiecție</p>
			</div>
		</div>

		<p class="text-[10px] text-muted-foreground text-center mt-2">
			{pacing.elapsedDays} din {pacing.totalDays} zile · {pacing.remainingDays} zile rămase
		</p>
	</Card>
{/if}
