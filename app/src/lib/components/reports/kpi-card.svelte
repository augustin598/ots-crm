<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { Component } from 'svelte';

	let {
		label,
		value,
		icon: Icon,
		subtext = ''
	}: {
		label: string;
		value: string;
		icon: Component<any>;
		subtext?: string;
	} = $props();
</script>

<Card class="p-4">
	<div class="flex items-center gap-3">
		<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
			<Icon class="h-6 w-6 text-primary" />
		</div>
		<div class="min-w-0">
			<p class="text-sm text-muted-foreground">{label}</p>
			<p class="text-2xl font-bold truncate">{value}</p>
			{#if subtext}
				<p class="text-xs text-muted-foreground mt-0.5">{subtext}</p>
			{/if}
		</div>
	</div>
</Card>
