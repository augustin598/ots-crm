<script lang="ts">
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { CheckCircle2, Circle, ChevronDown } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	let {
		title,
		description,
		completed = $bindable(false),
		defaultOpen = false,
		children
	}: {
		title: string;
		description?: string;
		completed?: boolean;
		defaultOpen?: boolean;
		children: import('svelte').Snippet;
	} = $props();

	let isOpen = $state(defaultOpen);
</script>

<Collapsible bind:open={isOpen} class="border rounded-lg bg-card">
	<CollapsibleTrigger
		class={cn(
			'flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-accent',
			isOpen && 'bg-accent'
		)}
	>
		<div class="flex items-center gap-3 flex-1">
			<div class="flex-shrink-0">
				{#if completed}
					<CheckCircle2 class="h-5 w-5 text-green-600" />
				{:else}
					<Circle class="h-5 w-5 text-muted-foreground" />
				{/if}
			</div>
			<div class="flex-1">
				<h3 class="font-semibold text-sm">{title}</h3>
				{#if description}
					<p class="text-xs text-muted-foreground mt-0.5">{description}</p>
				{/if}
			</div>
		</div>
		<ChevronDown
			class={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
		/>
	</CollapsibleTrigger>
	<CollapsibleContent class="px-4 pb-4">
		<div class="pt-2">
			{@render children()}
		</div>
	</CollapsibleContent>
</Collapsible>
