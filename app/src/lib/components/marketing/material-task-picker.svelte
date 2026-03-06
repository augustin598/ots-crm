<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import XIcon from '@lucide/svelte/icons/x';
	import SearchIcon from '@lucide/svelte/icons/search';

	let {
		materialId,
		linkedTasks = [],
		activeTasks = [],
		readonly = false,
		onLink,
		onUnlink
	}: {
		materialId: string;
		linkedTasks: { id: string; title: string; status: string }[];
		activeTasks: { id: string; title: string; status: string; clientId: string | null }[];
		readonly?: boolean;
		onLink?: (materialId: string, taskId: string) => void;
		onUnlink?: (materialId: string, taskId: string) => void;
	} = $props();

	let popoverOpen = $state(false);
	let search = $state('');

	const linkedTaskIds = $derived(new Set(linkedTasks.map((t) => t.id)));

	const filteredTasks = $derived(
		search.trim()
			? activeTasks.filter(
					(t) =>
						!linkedTaskIds.has(t.id) &&
						t.title.toLowerCase().includes(search.trim().toLowerCase())
				)
			: activeTasks.filter((t) => !linkedTaskIds.has(t.id))
	);

	const statusColors: Record<string, string> = {
		todo: 'bg-gray-400',
		'in-progress': 'bg-blue-500',
		review: 'bg-purple-500',
		'pending-approval': 'bg-yellow-500'
	};

	function handleSelect(taskId: string) {
		onLink?.(materialId, taskId);
		popoverOpen = false;
		search = '';
	}

	function handleUnlink(taskId: string) {
		onUnlink?.(materialId, taskId);
	}
</script>

<div class="flex flex-wrap items-center gap-1">
	{#if linkedTasks.length > 0}
		{#each linkedTasks as task}
			<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 max-w-[140px]">
				<span class="h-1.5 w-1.5 rounded-full shrink-0 {statusColors[task.status] || 'bg-gray-400'}"></span>
				<span class="truncate">{task.title}</span>
				{#if !readonly && onUnlink}
					<button
						class="shrink-0 hover:text-blue-900 dark:hover:text-blue-100 cursor-pointer"
						onclick={(e) => { e.stopPropagation(); handleUnlink(task.id); }}
						title="Dezasociază"
					>
						<XIcon class="h-3 w-3" />
					</button>
				{/if}
			</span>
		{/each}
	{/if}

	{#if !readonly && onLink}
		<Popover bind:open={popoverOpen}>
			<PopoverTrigger>
				<Button variant="ghost" size="icon" class="h-6 w-6" title="Asociază task">
					<ClipboardListIcon class="h-3.5 w-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent class="w-64 p-2" align="start">
				<div class="relative mb-2">
					<SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input bind:value={search} placeholder="Caută task..." class="pl-7 h-7 text-xs" />
				</div>
				<div class="max-h-[200px] overflow-y-auto space-y-0.5">
					{#if filteredTasks.length === 0}
						<p class="text-xs text-muted-foreground text-center py-2">Niciun task disponibil</p>
					{:else}
						{#each filteredTasks.slice(0, 20) as task}
							<button
								class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-accent/50 transition-colors cursor-pointer"
								onclick={() => handleSelect(task.id)}
							>
								<span class="h-2 w-2 rounded-full shrink-0 {statusColors[task.status] || 'bg-gray-400'}"></span>
								<span class="text-xs truncate">{task.title}</span>
							</button>
						{/each}
					{/if}
				</div>
			</PopoverContent>
		</Popover>
	{:else if linkedTasks.length === 0}
		<span class="text-xs text-muted-foreground">--</span>
	{/if}
</div>
