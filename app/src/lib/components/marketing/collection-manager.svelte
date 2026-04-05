<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Popover from '$lib/components/ui/popover';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';
	import {
		getMarketingCollections,
		createMarketingCollection,
		deleteMarketingCollection,
		addMaterialsToCollection
	} from '$lib/remotes/marketing-collections.remote';

	let {
		clientId = '',
		clientIds = [],
		activeCollectionId = $bindable<string | null>(null),
		selectedMaterialIds = new Set<string>(),
		onCollectionChange
	}: {
		clientId?: string;
		clientIds?: string[];
		activeCollectionId?: string | null;
		selectedMaterialIds?: Set<string>;
		onCollectionChange?: (id: string | null) => void;
	} = $props();

	let popoverOpen = $state(false);
	let newName = $state('');
	let creating = $state(false);
	let addingToCollection = $state(false);

	const collectionsQuery = $derived(
		getMarketingCollections({
			clientId: clientId || undefined,
			clientIds: clientIds.length > 0 ? clientIds : undefined
		})
	);
	const collections = $derived(collectionsQuery.current || []);

	const COLLECTION_COLORS = ['#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#ec4899', '#6366f1'];

	async function handleCreate() {
		if (!newName.trim() || !clientId || creating) return;
		creating = true;
		try {
			await createMarketingCollection({
				clientId,
				name: newName.trim(),
				color: COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length]
			}).updates(collectionsQuery);
			toast.success(`Colecția "${newName.trim()}" creată`);
			newName = '';
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la creare');
		} finally {
			creating = false;
		}
	}

	async function handleDelete(id: string, name: string) {
		try {
			await deleteMarketingCollection({ id }).updates(collectionsQuery);
			if (activeCollectionId === id) {
				activeCollectionId = null;
				onCollectionChange?.(null);
			}
			toast.success(`Colecția "${name}" ștearsă`);
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la ștergere');
		}
	}

	function selectCollection(id: string | null) {
		activeCollectionId = id;
		onCollectionChange?.(id);
		popoverOpen = false;
	}

	async function handleAddSelected(collectionId: string) {
		if (selectedMaterialIds.size === 0 || addingToCollection) return;
		addingToCollection = true;
		try {
			const result = await addMaterialsToCollection({
				collectionId,
				materialIds: [...selectedMaterialIds]
			}).updates(collectionsQuery);
			toast.success(`${result.added} materiale adăugate în colecție`);
		} catch (e: any) {
			toast.error(e?.message || 'Eroare');
		} finally {
			addingToCollection = false;
		}
	}

	const activeCollection = $derived(collections.find((c: any) => c.id === activeCollectionId));
</script>

<div class="flex items-center gap-1.5">
	<Popover.Root bind:open={popoverOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant={activeCollectionId ? 'default' : 'outline'} size="sm" class="h-8 gap-1.5 text-xs">
					<FolderIcon class="h-3.5 w-3.5" />
					{#if activeCollection}
						{activeCollection.name}
						<Badge variant="secondary" class="ml-1 h-4 min-w-4 px-1 text-[10px]">{activeCollection.materialCount}</Badge>
					{:else}
						Colecții
						{#if collections.length > 0}
							<Badge variant="outline" class="ml-1 h-4 min-w-4 px-1 text-[10px]">{collections.length}</Badge>
						{/if}
					{/if}
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-72 p-2" align="start">
			<!-- Header -->
			<div class="flex items-center justify-between mb-2">
				<p class="text-xs font-medium">Colecții</p>
				{#if activeCollectionId}
					<button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => selectCollection(null)}>
						Toate materialele
					</button>
				{/if}
			</div>

			<!-- Collection list -->
			<div class="max-h-[200px] overflow-y-auto space-y-0.5 mb-2">
				{#each collections as collection (collection.id)}
					<div class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 group/item">
						<button
							class="flex items-center gap-2 flex-1 text-left"
							onclick={() => selectCollection(collection.id)}
						>
							<span
								class="h-2.5 w-2.5 rounded-full shrink-0"
								style="background-color: {collection.color || '#6b7280'}"
							/>
							<span class="text-sm truncate flex-1">{collection.name}</span>
							<span class="text-[10px] text-muted-foreground">{collection.materialCount}</span>
							{#if activeCollectionId === collection.id}
								<CheckIcon class="h-3.5 w-3.5 text-primary shrink-0" />
							{/if}
						</button>

						<!-- Add selected materials to this collection -->
						{#if selectedMaterialIds.size > 0}
							<Button
								variant="ghost"
								size="sm"
								class="h-6 w-6 p-0 opacity-0 group-hover/item:opacity-100"
								onclick={() => handleAddSelected(collection.id)}
								title="Adaugă {selectedMaterialIds.size} selectate"
								disabled={addingToCollection}
							>
								{#if addingToCollection}
									<LoaderIcon class="h-3 w-3 animate-spin" />
								{:else}
									<PlusIcon class="h-3 w-3" />
								{/if}
							</Button>
						{/if}

						<Button
							variant="ghost"
							size="sm"
							class="h-6 w-6 p-0 opacity-0 group-hover/item:opacity-100 text-destructive"
							onclick={() => handleDelete(collection.id, collection.name)}
							title="Șterge colecția"
						>
							<Trash2Icon class="h-3 w-3" />
						</Button>
					</div>
				{/each}

				{#if collections.length === 0}
					<p class="text-xs text-muted-foreground text-center py-3">Nicio colecție încă</p>
				{/if}
			</div>

			<!-- Create new -->
			{#if clientId}
				<div class="border-t pt-2">
					<form class="flex items-center gap-1.5" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
						<Input
							bind:value={newName}
							placeholder="Nume colecție nouă..."
							class="h-7 text-xs flex-1"
						/>
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							class="h-7 w-7 p-0 shrink-0"
							disabled={!newName.trim() || creating}
						>
							{#if creating}
								<LoaderIcon class="h-3.5 w-3.5 animate-spin" />
							{:else}
								<FolderPlusIcon class="h-3.5 w-3.5" />
							{/if}
						</Button>
					</form>
				</div>
			{/if}
		</Popover.Content>
	</Popover.Root>

	<!-- Clear collection filter -->
	{#if activeCollectionId}
		<Button variant="ghost" size="sm" class="h-8 w-8 p-0" onclick={() => selectCollection(null)}>
			<XIcon class="h-3.5 w-3.5" />
		</Button>
	{/if}
</div>
