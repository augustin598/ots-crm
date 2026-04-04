<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { Component } from 'svelte';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';

	let {
		label,
		value,
		icon: Icon,
		subtext = '',
		change = undefined,
		invertChange = false
	}: {
		label: string;
		value: string;
		icon: Component<any>;
		subtext?: string;
		change?: number | undefined;
		invertChange?: boolean;
	} = $props();

	const changeText = $derived.by(() => {
		if (change === undefined || !isFinite(change)) return null;
		const sign = change > 0 ? '+' : '';
		return `${sign}${change.toFixed(1)}%`;
	});

	const isPositive = $derived(change !== undefined && change > 0);
	// For cost metrics (CPC, CPM, CPA), increase is bad → invertChange=true
	const isGood = $derived(invertChange ? !isPositive : isPositive);
</script>

<Card class="p-4">
	<div class="flex items-center gap-3">
		<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
			<Icon class="h-6 w-6 text-primary" />
		</div>
		<div class="min-w-0">
			<p class="text-sm text-muted-foreground">{label}</p>
			<div class="flex items-center gap-2">
				<p class="text-2xl font-bold truncate">{value}</p>
				{#if changeText && change !== 0}
					<span class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold
						{isGood ? 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30' : 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30'}">
						{#if isPositive}
							<TrendingUpIcon class="h-2.5 w-2.5" />
						{:else}
							<TrendingDownIcon class="h-2.5 w-2.5" />
						{/if}
						{changeText}
					</span>
				{/if}
			</div>
			{#if subtext}
				<p class="text-xs text-muted-foreground mt-0.5">{subtext}</p>
			{/if}
		</div>
	</div>
</Card>
