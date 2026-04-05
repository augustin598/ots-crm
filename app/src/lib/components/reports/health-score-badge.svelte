<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let {
		score,
		level,
		issues
	}: {
		score: number;
		level: 'good' | 'warning' | 'critical';
		issues: string[];
	} = $props();

	const variant = $derived(
		level === 'good' ? 'success' as const
		: level === 'warning' ? 'warning' as const
		: 'destructive' as const
	);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<Badge {variant} class="text-[10px] px-1.5 py-0.5 cursor-default">
			{score}
		</Badge>
	</Tooltip.Trigger>
	<Tooltip.Content side="top" sideOffset={4}>
		<div class="max-w-xs text-xs">
			<p class="font-semibold mb-1">
				Health Score: {score}/100
				{#if level === 'good'}— Bun{:else if level === 'warning'}— Atenție{:else}— Critic{/if}
			</p>
			{#if issues.length > 0}
				<ul class="space-y-0.5 list-disc pl-3">
					{#each issues as issue, i (i)}
						<li>{issue}</li>
					{/each}
				</ul>
			{:else}
				<p class="text-green-600 dark:text-green-400">Performanță bună!</p>
			{/if}
		</div>
	</Tooltip.Content>
</Tooltip.Root>
