<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import GoogleAdsIcon from '$lib/components/marketing/icon-google-ads.svelte';
	import FacebookIcon from '$lib/components/marketing/icon-facebook.svelte';
	import TiktokIcon from '$lib/components/marketing/icon-tiktok.svelte';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MaterialCard from './material-card.svelte';
	import MaterialListView from './material-list-view.svelte';

	const CATEGORY_ORDER = [
		'google-ads',
		'facebook-ads',
		'tiktok-ads',
		'press-article',
		'seo-article'
	] as const;

	const CATEGORY_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
		'google-ads': { label: 'Google Ads', icon: GoogleAdsIcon, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950' },
		'facebook-ads': { label: 'Facebook Ads', icon: FacebookIcon, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950' },
		'tiktok-ads': { label: 'TikTok Ads', icon: TiktokIcon, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-50 dark:bg-pink-950' },
		'press-article': { label: 'Articole Presă', icon: NewspaperIcon, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950' },
		'seo-article': { label: 'Articole SEO', icon: SearchIcon, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950' }
	};

	let {
		materials,
		thumbnailUrls = {},
		viewMode = 'grid',
		currentClientUserId = null,
		clientNameFn,
		onEdit,
		onDelete
	}: {
		materials: any[];
		thumbnailUrls?: Record<string, string | null>;
		viewMode?: 'grid' | 'list';
		currentClientUserId?: string | null;
		clientNameFn?: (clientId: string) => string;
		onEdit?: (material: any) => void;
		onDelete?: (material: any) => void;
	} = $props();

	// Group materials by category
	const groups = $derived.by(() => {
		const map = new Map<string, any[]>();
		for (const m of materials) {
			const cat = m.category || 'google-ads';
			if (!map.has(cat)) map.set(cat, []);
			map.get(cat)!.push(m);
		}
		return CATEGORY_ORDER
			.filter((cat) => map.has(cat))
			.map((cat) => ({
				category: cat,
				meta: CATEGORY_META[cat],
				materials: map.get(cat)!
			}));
	});

	// Collapsed state per category
	let collapsed = $state<Record<string, boolean>>({});

	function toggleCollapse(cat: string) {
		collapsed = { ...collapsed, [cat]: !collapsed[cat] };
	}
</script>

<div class="space-y-6">
	{#each groups as group (group.category)}
		{@const meta = group.meta}
		{@const isCollapsed = collapsed[group.category] ?? false}

		<div class="rounded-lg border bg-card overflow-hidden">
			<!-- Group header -->
			<button
				class="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer"
				onclick={() => toggleCollapse(group.category)}
			>
				<div class="flex items-center justify-center h-8 w-8 rounded-lg {meta.bg} shrink-0">
					<meta.icon class="h-4 w-4 {meta.color}" />
				</div>
				<div class="flex-1 text-left">
					<span class="text-sm font-semibold">{meta.label}</span>
				</div>
				<span class="text-xs text-muted-foreground tabular-nums">
					{group.materials.length} material{group.materials.length !== 1 ? 'e' : ''}
				</span>
				<ChevronDownIcon
					class="h-4 w-4 text-muted-foreground transition-transform duration-200 {isCollapsed ? '-rotate-90' : ''}"
				/>
			</button>

			<!-- Group content -->
			{#if !isCollapsed}
				<div class="px-4 pb-4 pt-1">
					{#if viewMode === 'list'}
						<MaterialListView
							materials={group.materials}
							{currentClientUserId}
							{clientNameFn}
							{onEdit}
							{onDelete}
						/>
					{:else}
						<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each group.materials as material (material.id)}
								<MaterialCard
									{material}
									thumbnailUrl={thumbnailUrls[material.id] || null}
									{currentClientUserId}
									onEdit={onEdit}
									onDelete={onDelete}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	{#if groups.length === 0}
		<div class="text-center py-12 text-muted-foreground">
			<p class="text-sm">Niciun material găsit.</p>
		</div>
	{/if}
</div>
