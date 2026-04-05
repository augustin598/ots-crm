<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import { RangeCalendar } from '$lib/components/ui/range-calendar';
	import { type DateValue } from '@internationalized/date';
	import type { DateRange } from 'bits-ui';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TypeIcon from '@lucide/svelte/icons/type';
	import LinkIcon from '@lucide/svelte/icons/link';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import XIcon from '@lucide/svelte/icons/x';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';

	let {
		filterType = $bindable(''),
		searchTerm = $bindable(''),
		viewMode = $bindable<'grid' | 'list'>('grid'),
		dateRange = $bindable<DateRange>({ start: undefined, end: undefined }),
		activeCategory = 'all',
		materials = []
	}: {
		filterType: string;
		searchTerm: string;
		viewMode: 'grid' | 'list';
		dateRange: DateRange;
		activeCategory?: string;
		materials?: any[];
	} = $props();

	let dateOpen = $state(false);

	// Debounce search — local input value syncs to parent after 300ms
	let localSearch = $state(searchTerm);
	let searchTimeout: ReturnType<typeof setTimeout>;

	$effect(() => {
		// Sync from parent when it resets (e.g. tab switch)
		if (searchTerm === '' && localSearch !== '') {
			localSearch = '';
		}
	});

	function handleSearchInput(e: Event) {
		localSearch = (e.target as HTMLInputElement).value;
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchTerm = localSearch;
		}, 300);
	}

	const dateRangeLabel = $derived.by(() => {
		const { start, end } = dateRange;
		if (!start) return 'Perioadă';
		const fmt = (d: DateValue) =>
			new Date(d.year, d.month - 1, d.day).toLocaleDateString('ro-RO', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		if (!end) return fmt(start);
		return `${fmt(start)} – ${fmt(end)}`;
	});

	const allTypeFilters = [
		{ id: '', label: 'Toate', icon: null },
		{ id: 'image', label: 'Imagine', icon: ImageIcon },
		{ id: 'video', label: 'Video', icon: VideoIcon },
		{ id: 'document', label: 'Document', icon: FileTextIcon },
		{ id: 'text', label: 'Text', icon: TypeIcon },
		{ id: 'url', label: 'URL', icon: LinkIcon }
	];

	// Hide irrelevant type filters per category
	const hiddenTypesPerCategory: Record<string, string[]> = {
		'google-ads': ['url', 'document'],
		'facebook-ads': ['text', 'document'],
		'tiktok-ads': ['text', 'document'],
		'press-article': ['url', 'text'],
		'seo-article': ['url', 'text']
	};

	const typeFilters = $derived(
		activeCategory === 'all'
			? allTypeFilters
			: allTypeFilters.filter((f) => !hiddenTypesPerCategory[activeCategory]?.includes(f.id))
	);

	// Reset filterType if current selection is hidden in new category
	$effect(() => {
		if (filterType && hiddenTypesPerCategory[activeCategory]?.includes(filterType)) {
			filterType = '';
		}
	});

	// Count materials per type
	const typeCounts = $derived.by(() => {
		if (materials.length === 0) return {};
		const counts: Record<string, number> = {};
		for (const f of allTypeFilters) {
			if (f.id === '') continue;
			counts[f.id] = materials.filter((m: any) => m.type === f.id).length;
		}
		return counts;
	});
</script>

<div class="flex flex-wrap items-center gap-3">
	<div class="flex items-center gap-1.5">
		{#each typeFilters as filter (filter.id)}
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
				{#if filter.id && typeCounts[filter.id] != null}
					<Badge variant={filterType === filter.id ? 'secondary' : 'outline'} class="ml-1 h-4 min-w-4 px-1 text-[10px]">
						{typeCounts[filter.id]}
					</Badge>
				{/if}
			</Button>
		{/each}
	</div>

	<div class="relative flex-1 min-w-[200px] max-w-xs">
		<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 {localSearch !== searchTerm ? 'text-primary' : 'text-muted-foreground'}" />
		<Input
			type="text"
			placeholder="Caută materiale..."
			class="pl-9 h-8 text-sm"
			value={localSearch}
			oninput={handleSearchInput}
		/>
	</div>

	<!-- Date range filter -->
	<div class="flex items-center gap-0.5">
		<Popover.Root bind:open={dateOpen}>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						size="sm"
						class="h-8 text-xs justify-start font-normal {dateRange.start ? '' : 'text-muted-foreground'}"
					>
						<CalendarIcon class="h-3.5 w-3.5 mr-1.5 shrink-0 opacity-50" />
						{dateRangeLabel}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-auto p-0" align="start">
				<div class="flex flex-col">
					<RangeCalendar
						bind:value={dateRange}
						locale="ro-RO"
						weekStartsOn={1}
						onValueChange={() => {
							if (dateRange.start && dateRange.end) dateOpen = false;
						}}
					/>
					<Button
						variant="ghost"
						class="rounded-t-none border-t text-muted-foreground text-sm"
						onclick={() => {
							dateRange = { start: undefined, end: undefined };
							dateOpen = false;
						}}
					>
						Șterge filtru dată
					</Button>
				</div>
			</Popover.Content>
		</Popover.Root>
		{#if dateRange.start}
			<Button
				variant="ghost"
				size="sm"
				class="h-8 w-8 p-0"
				onclick={() => {
					dateRange = { start: undefined, end: undefined };
				}}
			>
				<XIcon class="h-3.5 w-3.5" />
			</Button>
		{/if}
	</div>

	<!-- View toggle -->
	<div class="flex items-center gap-0.5 border rounded-md p-0.5 ml-auto">
		<Button
			variant={viewMode === 'grid' ? 'default' : 'ghost'}
			size="sm"
			class="h-7 w-7 p-0"
			onclick={() => (viewMode = 'grid')}
			aria-label="Vizualizare grilă"
		>
			<LayoutGridIcon class="h-4 w-4" />
		</Button>
		<Button
			variant={viewMode === 'list' ? 'default' : 'ghost'}
			size="sm"
			class="h-7 w-7 p-0"
			onclick={() => (viewMode = 'list')}
			aria-label="Vizualizare listă"
		>
			<ListIcon class="h-4 w-4" />
		</Button>
	</div>
</div>
