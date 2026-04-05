<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import type { ExecutiveSummary } from '$lib/utils/advanced-kpi';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';

	let {
		summary,
		currency = 'RON'
	}: {
		summary: ExecutiveSummary;
		currency?: string;
	} = $props();

	const fmt = (v: number) => new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
	const fmtNum = (v: number) => new Intl.NumberFormat('ro-RO').format(Math.round(v));

	const healthVariant = $derived(
		summary.healthScore >= 80 ? 'success' as const
		: summary.healthScore >= 50 ? 'warning' as const
		: 'destructive' as const
	);
</script>

<Card class="p-5">
	<div class="flex items-start gap-3 mb-4">
		<ClipboardListIcon class="h-5 w-5 text-primary mt-0.5" />
		<div>
			<h3 class="text-sm font-semibold">Rezumat Executiv</h3>
			<p class="text-xs text-muted-foreground">Privire de ansamblu asupra contului</p>
		</div>
		<Badge variant={healthVariant} class="ml-auto">
			Health: {summary.healthScore} — {summary.healthLevel}
		</Badge>
	</div>

	<!-- Key metrics -->
	<div class="grid grid-cols-4 gap-4 mb-4">
		<div>
			<p class="text-xs text-muted-foreground">Cheltuieli totale</p>
			<p class="text-lg font-bold">{fmt(summary.totalSpend)}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">CPM mediu</p>
			<p class="text-lg font-bold">{summary.avgCpm > 0 ? fmt(summary.avgCpm) : '—'}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">CTR mediu</p>
			<p class="text-lg font-bold">{summary.avgCtr > 0 ? summary.avgCtr.toFixed(2) + '%' : '—'}</p>
		</div>
		<div>
			<p class="text-xs text-muted-foreground">Conversii</p>
			<p class="text-lg font-bold">{fmtNum(summary.totalConversions)}</p>
		</div>
	</div>

	<!-- Top campaigns -->
	{#if summary.topCampaigns.length > 0}
		<div class="mb-4">
			<p class="text-xs font-medium text-muted-foreground mb-1.5">Top campanii (spend)</p>
			<div class="space-y-1">
				{#each summary.topCampaigns as camp, i (camp.name)}
					<div class="flex items-center justify-between text-xs">
						<span class="truncate flex-1 mr-2">
							<span class="text-muted-foreground">{i + 1}.</span> {camp.name}
						</span>
						<span class="shrink-0 text-muted-foreground">
							{fmt(camp.spend)} · {fmtNum(camp.conversions)} conv.
							{#if camp.roas > 0}
								· {camp.roas.toFixed(1)}x ROAS
							{/if}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Top issues -->
	{#if summary.topIssues.length > 0}
		<div class="mb-4">
			<p class="text-xs font-medium text-muted-foreground mb-1.5">Probleme principale</p>
			<ul class="space-y-0.5">
				{#each summary.topIssues as issue}
					<li class="text-xs text-amber-700 dark:text-amber-400">• {issue}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Recommendation -->
	<div class="rounded-lg bg-primary/5 p-3">
		<p class="text-xs font-medium text-primary">{summary.recommendation}</p>
	</div>
</Card>
