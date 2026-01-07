<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	type BreadcrumbItem = {
		label: string;
		href?: string;
	};

	let {
		items,
		class: className
	}: {
		items: BreadcrumbItem[];
		class?: string;
	} = $props();
</script>

<nav aria-label="Breadcrumb" class={cn('flex', className)}>
	<ol class="flex items-center space-x-1 text-sm text-muted-foreground">
		{#each items as item, i}
			<li class="flex items-center">
				{#if i > 0}
					<ChevronRight class="h-4 w-4 mx-1" />
				{/if}
				{#if item.href && i < items.length - 1}
					<a href={item.href} class="hover:text-foreground transition-colors">
						{item.label}
					</a>
				{:else}
					<span class={i === items.length - 1 ? 'text-foreground font-medium' : ''}>{item.label}</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
