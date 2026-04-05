<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { CreativeFatigueResult } from '$lib/utils/advanced-kpi';

	let { result }: { result: CreativeFatigueResult } = $props();

	const variant = $derived(
		result.level === 'fresh' ? 'success' as const
		: result.level === 'warning' ? 'warning' as const
		: 'destructive' as const
	);

	const label = $derived(
		result.level === 'fresh' ? 'Fresh'
		: result.level === 'warning' ? 'Atenție'
		: 'Obosit'
	);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<Badge {variant} class="text-[10px] px-1.5 py-0.5 cursor-default">
			{label}
		</Badge>
	</Tooltip.Trigger>
	<Tooltip.Content side="top" sideOffset={4}>
		<div class="max-w-xs text-xs space-y-1">
			<p class="font-semibold">{result.message}</p>
			{#if result.frequencyTrend !== 0 || result.ctrTrend !== 0}
				<p>Frecvență: {result.frequencyTrend > 0 ? '+' : ''}{result.frequencyTrend.toFixed(1)}%</p>
				<p>CTR: {result.ctrTrend > 0 ? '+' : ''}{result.ctrTrend.toFixed(1)}%</p>
			{/if}
		</div>
	</Tooltip.Content>
</Tooltip.Root>
