<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TypeIcon from '@lucide/svelte/icons/type';
	import LinkIcon from '@lucide/svelte/icons/link';

	let {
		filterType = $bindable(''),
		searchTerm = $bindable('')
	}: {
		filterType: string;
		searchTerm: string;
	} = $props();

	const typeFilters = [
		{ id: '', label: 'Toate', icon: null },
		{ id: 'image', label: 'Imagine', icon: ImageIcon },
		{ id: 'video', label: 'Video', icon: VideoIcon },
		{ id: 'document', label: 'Document', icon: FileTextIcon },
		{ id: 'text', label: 'Text', icon: TypeIcon },
		{ id: 'url', label: 'URL', icon: LinkIcon }
	];
</script>

<div class="flex flex-wrap items-center gap-3">
	<div class="flex items-center gap-1.5">
		{#each typeFilters as filter}
			<Button
				variant={filterType === filter.id ? 'default' : 'outline'}
				size="sm"
				class="h-8 text-xs"
				onclick={() => (filterType = filter.id)}
			>
				{#if filter.icon}
					{@const Icon = filter.icon}
					<Icon class="h-3.5 w-3.5 mr-1" />
				{/if}
				{filter.label}
			</Button>
		{/each}
	</div>

	<div class="relative flex-1 min-w-[200px] max-w-xs">
		<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
		<Input
			type="text"
			placeholder="Caută materiale..."
			class="pl-9 h-8 text-sm"
			bind:value={searchTerm}
		/>
	</div>
</div>
