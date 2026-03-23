<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { Component } from 'svelte';

	let {
		title,
		icon: Icon,
		data,
		onclick
	}: {
		title: string;
		icon: Component<{ class?: string }>;
		data: { label: string; value: number; percent: number; color: string }[];
		onclick: () => void;
	} = $props();

	const topItems = $derived(data.slice(0, 4));
	const hasData = $derived(data.length > 0 && data.some(d => d.value > 0));
</script>

<button class="text-left w-full" onclick={onclick}>
	<Card class="p-4 cursor-pointer hover:shadow-md transition-all hover:border-primary/30 h-full">
		<div class="flex items-center gap-2 mb-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
				<Icon class="h-4 w-4 text-primary" />
			</div>
			<h4 class="text-sm font-semibold">{title}</h4>
		</div>

		{#if hasData}
			<div class="space-y-2">
				{#each topItems as item}
					<div class="space-y-0.5">
						<div class="flex items-center justify-between text-xs">
							<span class="text-muted-foreground truncate max-w-[120px]">{item.label}</span>
							<span class="font-medium tabular-nums">{item.percent.toFixed(1)}%</span>
						</div>
						<div class="h-1.5 w-full rounded-full bg-muted overflow-hidden">
							<div
								class="h-full rounded-full transition-all"
								style="width: {Math.max(item.percent, 1)}%; background-color: {item.color}"
							></div>
						</div>
					</div>
				{/each}
			</div>
			{#if data.length > 4}
				<p class="text-[10px] text-muted-foreground mt-2">+{data.length - 4} alte segmente</p>
			{/if}
		{:else}
			<div class="flex items-center justify-center h-16">
				<p class="text-xs text-muted-foreground">Nu sunt date</p>
			</div>
		{/if}
	</Card>
</button>
