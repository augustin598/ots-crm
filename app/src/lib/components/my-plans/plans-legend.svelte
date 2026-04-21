<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { STATUS_GROUP_DOT_CLASSES } from './filters';
	import { onMount } from 'svelte';

	const STORAGE_KEY = 'my-plans-legend-open';
	let open = $state(true);

	onMount(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw !== null) open = raw === '1';
		} catch {
			// ignore
		}
	});

	function handleOpenChange(next: boolean) {
		open = next;
		try {
			localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
		} catch {
			// ignore
		}
	}
</script>

<Collapsible.Root {open} onOpenChange={handleOpenChange}>
	<Collapsible.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="sm" class="text-xs text-muted-foreground">
				{#if open}
					<ChevronDown class="mr-1 h-3 w-3" />
				{:else}
					<ChevronRight class="mr-1 h-3 w-3" />
				{/if}
				Legendă
			</Button>
		{/snippet}
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div
			class="flex flex-wrap items-center gap-4 px-3 py-2 text-xs text-muted-foreground"
			aria-label="Legendă culori"
			role="group"
		>
			<div class="flex items-center gap-3">
				<span class="font-medium text-foreground">Status:</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full {STATUS_GROUP_DOT_CLASSES.todo}"></span>
					To do
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full {STATUS_GROUP_DOT_CLASSES['in-progress']}"></span>
					In progress
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full {STATUS_GROUP_DOT_CLASSES.done}"></span>
					Done
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full {STATUS_GROUP_DOT_CLASSES.cancelled}"></span>
					Cancelled
				</span>
			</div>
			<span class="text-border">│</span>
			<div class="flex items-center gap-3">
				<span class="font-medium text-foreground">Priority:</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-3 w-1 rounded-sm bg-red-500"></span>Urgent
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-3 w-1 rounded-sm bg-orange-500"></span>High
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-3 w-1 rounded-sm bg-blue-500"></span>Medium
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="h-3 w-1 rounded-sm bg-emerald-500"></span>Low
				</span>
			</div>
			<span class="text-border">│</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="h-2 w-2 rounded-full ring-1 ring-red-500 ring-offset-1"></span>
				Overdue
			</span>
		</div>
	</Collapsible.Content>
</Collapsible.Root>
