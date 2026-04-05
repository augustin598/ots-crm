<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { CpaMomentum } from '$lib/utils/advanced-kpi';
	import type { Component } from 'svelte';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import ActivityIcon from '@lucide/svelte/icons/activity';

	let {
		momentum,
		currency = 'RON'
	}: {
		momentum: CpaMomentum;
		currency?: string;
	} = $props();

	const fmt = (v: number | null) => {
		if (v === null) return '—';
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
	};

	const trendColor = $derived(
		momentum.trend === 'improving' ? 'text-green-600 dark:text-green-400'
		: momentum.trend === 'degrading' ? 'text-red-600 dark:text-red-400'
		: 'text-muted-foreground'
	);

	const TrendIcon = $derived(
		momentum.trend === 'improving' ? TrendingDownIcon
		: momentum.trend === 'degrading' ? TrendingUpIcon
		: MinusIcon
	);
</script>

<Card class="p-4">
	<div class="flex items-center gap-3">
		<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
			<ActivityIcon class="h-6 w-6 text-primary" />
		</div>
		<div class="min-w-0">
			<p class="text-sm text-muted-foreground">CPA Momentum</p>
			<div class="flex items-center gap-3 mt-1">
				<div class="text-center">
					<p class="text-lg font-bold">{fmt(momentum.cpa1d)}</p>
					<p class="text-[10px] text-muted-foreground">1 zi</p>
				</div>
				<div class="text-center">
					<p class="text-lg font-bold">{fmt(momentum.cpa7d)}</p>
					<p class="text-[10px] text-muted-foreground">7 zile</p>
				</div>
				<div class="text-center">
					<p class="text-lg font-bold">{fmt(momentum.cpa30d)}</p>
					<p class="text-[10px] text-muted-foreground">30 zile</p>
				</div>
			</div>
			<div class="flex items-center gap-1 mt-1 {trendColor}">
				<TrendIcon class="h-3 w-3" />
				<span class="text-xs font-medium">{momentum.message}</span>
			</div>
		</div>
	</div>
</Card>
