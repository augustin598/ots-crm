<script lang="ts">
	import { cn } from '$lib/utils';
	import { ACTIVITY_CATEGORIES } from '$lib/utils/activity-icons.svelte';

	let { activeFilter = $bindable('all') }: { activeFilter: string } = $props();
</script>

<div class="flex flex-wrap gap-1.5">
	{#each ACTIVITY_CATEGORIES as cat}
		<button
			class={cn(
				'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
				activeFilter === cat.id
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
			)}
			onclick={() => (activeFilter = cat.id)}
		>
			{cat.label}
		</button>
	{/each}
</div>
