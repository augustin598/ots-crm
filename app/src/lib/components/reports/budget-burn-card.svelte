<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { BudgetBurnForecast } from '$lib/utils/advanced-kpi';
	import type { Component } from 'svelte';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';

	let {
		forecast,
		currency = 'RON',
		icon: Icon = TrendingUpIcon
	}: {
		forecast: BudgetBurnForecast;
		currency?: string;
		icon?: Component<any>;
	} = $props();

	const fmt = (v: number) => new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

	const hasBudget = $derived(forecast.burnRate !== null);

	const statusColor = $derived(
		!hasBudget ? 'text-muted-foreground'
		: forecast.status === 'overspend' ? 'text-red-600 dark:text-red-400'
		: forecast.status === 'underspend' ? 'text-amber-600 dark:text-amber-400'
		: 'text-green-600 dark:text-green-400'
	);

	const statusLabel = $derived(
		!hasBudget ? 'Buget nesetat'
		: forecast.status === 'overspend' ? 'Peste buget'
		: forecast.status === 'underspend' ? 'Sub buget'
		: 'Pe drumul bun'
	);

	const progressPct = $derived(
		hasBudget ? Math.round(forecast.burnRate! * 100) : null
	);

	const budgetAmount = $derived(
		hasBudget && forecast.burnRate ? Math.round(forecast.projectedSpend / forecast.burnRate) : null
	);

	const targetDailySpend = $derived(
		budgetAmount && forecast.daysRemaining > 0
			? Math.max(0, (budgetAmount - forecast.currentSpend) / forecast.daysRemaining)
			: null
	);

	const barColor = $derived(
		forecast.status === 'overspend' ? 'bg-red-500'
		: forecast.status === 'underspend' ? 'bg-amber-500'
		: 'bg-green-500'
	);
</script>

<Card class="p-4">
	<div class="flex items-center gap-3">
		<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
			<Icon class="h-6 w-6 text-primary" />
		</div>
		<div class="min-w-0 flex-1">
			<p class="text-sm text-muted-foreground">Proiecție lunară</p>
			<p class="text-2xl font-bold truncate">{fmt(forecast.projectedSpend)}</p>
			<div class="flex items-center gap-2 mt-1">
				<span class="text-xs {statusColor} font-medium">
					{statusLabel}
					{#if progressPct !== null}
						({progressPct}%)
					{/if}
				</span>
				<span class="text-xs text-muted-foreground">
					{fmt(forecast.dailyAvgSpend)}/zi &middot; {forecast.daysRemaining} zile rămase
					{#if targetDailySpend !== null && hasBudget && forecast.status !== 'on-track'}
						&middot; revino la {fmt(targetDailySpend)}/zi pentru a te încadra în buget
					{/if}
				</span>
			</div>
			{#if progressPct !== null && budgetAmount}
				<div class="mt-2 h-1.5 w-full rounded-full bg-muted">
					<div class="h-full rounded-full {barColor} transition-all" style="width: {Math.min(progressPct, 100)}%"></div>
				</div>
				<p class="text-[10px] text-muted-foreground mt-0.5">
					{fmt(forecast.currentSpend)} cheltuit din {fmt(budgetAmount)} buget &middot;
					<span class="font-medium {statusColor}">proiecție {fmt(forecast.projectedSpend)} ({progressPct}% din buget)</span>
				</p>
			{/if}
		</div>
	</div>
</Card>
