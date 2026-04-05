<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { DayOfWeekMetrics } from '$lib/utils/advanced-kpi';

	let { data }: { data: DayOfWeekMetrics[] } = $props();

	const metrics = [
		{ key: 'ctrScore' as const, label: 'CTR', format: (d: DayOfWeekMetrics) => d.ctr.toFixed(2) + '%' },
		{ key: 'cpcScore' as const, label: 'CPC', format: (d: DayOfWeekMetrics) => d.cpc.toFixed(2) },
		{ key: 'conversionScore' as const, label: 'Conv.', format: (d: DayOfWeekMetrics) => d.conversions.toFixed(1) }
	];

	function formatShortDate(dateStr: string): string {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		const monthNames = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${monthNames[d.getMonth()]} ${d.getDate()}`;
	}

	function heatColor(score: number): string {
		if (score >= 0.8) return 'bg-green-500/80 text-white';
		if (score >= 0.6) return 'bg-green-300/60 text-green-900 dark:text-green-100';
		if (score >= 0.4) return 'bg-yellow-200/60 text-yellow-900 dark:text-yellow-100';
		if (score >= 0.2) return 'bg-orange-200/60 text-orange-900 dark:text-orange-100';
		if (score > 0) return 'bg-red-200/60 text-red-900 dark:text-red-100';
		return 'bg-muted text-muted-foreground';
	}
</script>

<Card class="p-4">
	<h3 class="text-sm font-semibold mb-1">Performanță pe zi</h3>
	<p class="text-xs text-muted-foreground mb-3">Media zilnică — verde = cel mai bun</p>

	{#if data.length === 0}
		<p class="text-sm text-muted-foreground">Fără date</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr>
						<th class="text-left pb-1 pr-2 font-medium text-muted-foreground"></th>
						{#each data as day (day.day)}
							<th class="text-center pb-1 px-1 font-medium text-muted-foreground">
								<div>{day.dayLabel}</div>
								{#if day.lastDate}
									<div class="text-[9px] font-normal text-muted-foreground/70">{formatShortDate(day.lastDate)}</div>
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each metrics as metric (metric.key)}
						<tr>
							<td class="pr-2 py-0.5 font-medium text-muted-foreground whitespace-nowrap">{metric.label}</td>
							{#each data as day (day.day)}
								{@const score = day[metric.key]}
								<td class="text-center px-1 py-0.5">
									<div class="rounded px-1 py-0.5 {heatColor(score)}" title="{metric.label}: {metric.format(day)}">
										{metric.format(day)}
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>
