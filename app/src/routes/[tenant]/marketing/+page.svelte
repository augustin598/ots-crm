<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import SearchIcon from '@lucide/svelte/icons/search';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import Layers3Icon from '@lucide/svelte/icons/layers-3';
	import GoogleAdsIcon from '$lib/components/marketing/icon-google-ads.svelte';
	import FacebookIcon from '$lib/components/marketing/icon-facebook.svelte';
	import TiktokIcon from '$lib/components/marketing/icon-tiktok.svelte';
	import MaterialCard from '$lib/components/marketing/material-card.svelte';
	import MaterialFilters from '$lib/components/marketing/material-filters.svelte';
	import MaterialUploadDialog from '$lib/components/marketing/material-upload-dialog.svelte';
	import MaterialInlineUpload from '$lib/components/marketing/material-inline-upload.svelte';
	import MaterialEditDialog from '$lib/components/marketing/material-edit-dialog.svelte';
	import MaterialListView from '$lib/components/marketing/material-list-view.svelte';
	import GoogleAdsAssetDialog from '$lib/components/marketing/google-ads-asset-dialog.svelte';
	import SocialUrlDialog from '$lib/components/marketing/social-url-dialog.svelte';
	import ArticleUploadDialog from '$lib/components/marketing/article-upload-dialog.svelte';
	import MaterialGroupedView from '$lib/components/marketing/material-grouped-view.svelte';
	import MaterialSkeleton from '$lib/components/marketing/material-skeleton.svelte';
	import ImageLightbox from '$lib/components/image-lightbox.svelte';
	import MaterialPreviewDialog from '$lib/components/marketing/material-preview-dialog.svelte';
	import CollectionManager from '$lib/components/marketing/collection-manager.svelte';
	import { getMarketingMaterials, deleteMarketingMaterial, getMaterialDownloadUrl, getMaterialPreviewUrl } from '$lib/remotes/marketing-materials.remote';
	import { getCollectionMaterialIds } from '$lib/remotes/marketing-collections.remote';
	import { linkMaterialToTask, unlinkMaterialFromTask } from '$lib/remotes/task-materials.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import LinkIcon from '@lucide/svelte/icons/link';
	import type { DateRange } from 'bits-ui';

	const tenantSlug = $derived(page.params.tenant as string);

	let activeCategory = $state('all');
	let filterType = $state('');
	let searchTerm = $state('');
	let dateRange = $state<DateRange>({ start: undefined, end: undefined });
	let refreshKey = $state(0);
	let uploadDialogOpen = $state(false);
	let googleAdsDialogOpen = $state(false);
	let socialUrlDialogOpen = $state(false);
	let articleDialogOpen = $state(false);
	let activeCollectionId = $state<string | null>(null);
	let editDialogOpen = $state(false);
	let editMaterial = $state<any>(null);
	let deleteConfirmOpen = $state(false);
	let deleteTarget = $state<any>(null);
	let deleting = $state(false);

	// View mode with localStorage persistence
	let viewMode = $state<'grid' | 'list'>(
		browser ? (localStorage.getItem('marketing-view-mode') as 'grid' | 'list') || 'grid' : 'grid'
	);

	$effect(() => {
		if (browser) {
			localStorage.setItem('marketing-view-mode', viewMode);
		}
	});

	// Load all clients for the filter
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const activeClients = $derived(clients.filter((c: any) => c.status === 'active'));

	// Multi-select client filter — separate from Clients page, default none
	const STORAGE_KEY = (tenant: string) => `crm-marketing-clients-${tenant}`;
	let selectedClientIds = $state<string[]>([]);
	let clientFilterPopoverOpen = $state(false);
	let clientFilterSearch = $state('');
	let initialized = $state(false);

	const popoverClients = $derived(
		clientFilterSearch.trim()
			? activeClients.filter((c: any) => c.name.toLowerCase().includes(clientFilterSearch.trim().toLowerCase()))
			: activeClients
	);

	// Init from own localStorage key, default empty
	$effect(() => {
		if (activeClients.length > 0 && !initialized) {
			initialized = true;
			if (browser && tenantSlug) {
				try {
					const stored = localStorage.getItem(STORAGE_KEY(tenantSlug));
					if (stored) {
						const ids = JSON.parse(stored);
						if (Array.isArray(ids) && ids.length > 0) {
							selectedClientIds = ids;
							return;
						}
					}
				} catch { /* ignore */ }
			}
			selectedClientIds = [];
		}
	});

	// Save to own key
	$effect(() => {
		if (!browser || !tenantSlug || !initialized) return;
		if (selectedClientIds.length > 0) {
			localStorage.setItem(STORAGE_KEY(tenantSlug), JSON.stringify(selectedClientIds));
		} else {
			localStorage.removeItem(STORAGE_KEY(tenantSlug));
		}
	});

	function toggleClient(clientId: string) {
		if (selectedClientIds.includes(clientId)) {
			selectedClientIds = selectedClientIds.filter((id) => id !== clientId);
		} else {
			selectedClientIds = [...selectedClientIds, clientId];
		}
	}

	function selectAllClients() {
		selectedClientIds = activeClients.map((c: any) => c.id);
	}

	function clearClientFilter() {
		selectedClientIds = [];
	}

	const materialsQuery = $derived(
		getMarketingMaterials({
			clientId: selectedClientIds.length === 1 ? selectedClientIds[0] : undefined,
			clientIds: selectedClientIds.length > 1 && selectedClientIds.length < activeClients.length ? selectedClientIds : undefined,
			category: activeCategory === 'all' ? undefined : activeCategory,
			type: filterType || undefined,
			search: searchTerm.trim() || undefined,
			_refresh: refreshKey
		} as any)
	);
	const materials = $derived(materialsQuery.current || []);
	const loading = $derived(!materialsQuery.current && !materialsQuery.error);
	const filteredMaterials = $derived.by(() => {
		if (!dateRange.start) return materials;
		return materials.filter((m: any) => {
			const d = new Date(m.createdAt);
			const startDate = new Date(dateRange.start!.year, dateRange.start!.month - 1, dateRange.start!.day);
			if (d < startDate) return false;
			if (dateRange.end) {
				const endDate = new Date(dateRange.end.year, dateRange.end.month - 1, dateRange.end.day + 1);
				if (d >= endDate) return false;
			}
			return true;
		});
	});

	// Collection filter — fetch material IDs when a collection is selected
	const collectionMaterialIdsQuery = $derived(
		activeCollectionId ? getCollectionMaterialIds({ collectionId: activeCollectionId }) : null
	);
	const collectionMaterialIds = $derived(
		collectionMaterialIdsQuery?.current ? new Set(collectionMaterialIdsQuery.current) : null
	);

	// Apply collection filter on top of date-filtered materials
	const displayMaterials = $derived(
		collectionMaterialIds
			? filteredMaterials.filter((m: any) => collectionMaterialIds.has(m.id))
			: filteredMaterials
	);

	// Multi-select state
	let selectedIds = $state<Set<string>>(new Set());
	let batchDeleting = $state(false);
	const selectedCount = $derived(selectedIds.size);
	const allSelected = $derived(displayMaterials.length > 0 && selectedIds.size === displayMaterials.length);

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedIds = next;
	}

	function toggleSelectAll() {
		if (allSelected) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(displayMaterials.map((m: any) => m.id));
		}
	}

	function clearSelection() {
		selectedIds = new Set();
	}

	async function handleBatchDelete() {
		if (selectedCount === 0 || batchDeleting) return;
		batchDeleting = true;
		let deleted = 0;
		try {
			for (const id of selectedIds) {
				await deleteMarketingMaterial(id);
				deleted++;
			}
			toast.success(`${deleted} materiale șterse`);
			selectedIds = new Set();
			refreshKey++;
		} catch (e: any) {
			clientLogger.apiError('marketing_batch_delete', e);
			if (deleted > 0) {
				toast.success(`${deleted} șterse, eroare la restul`);
				refreshKey++;
			}
		} finally {
			batchDeleting = false;
		}
	}

	// Clear selection when filters change
	$effect(() => {
		void activeCategory;
		void filterType;
		void searchTerm;
		untrack(() => { selectedIds = new Set(); });
	});

	// For upload dialogs — pick first selected client or empty
	const uploadClientId = $derived(selectedClientIds.length === 1 ? selectedClientIds[0] : '');

	// SEO links for the seo-article combobox (upload)
	const seoLinksQuery = $derived(getSeoLinks({ clientId: uploadClientId || undefined }));
	const seoLinks = $derived(
		(seoLinksQuery.current || []).map((l: any) => ({
			id: l.id,
			keyword: l.keyword,
			articleUrl: l.articleUrl
		}))
	);

	// SEO links scoped to the edited material's client (BUG 6)
	const editSeoLinksQuery = $derived(editMaterial?.clientId ? getSeoLinks({ clientId: editMaterial.clientId }) : null);
	const editSeoLinks = $derived(
		editSeoLinksQuery
			? (editSeoLinksQuery.current || []).map((l: any) => ({
					id: l.id,
					keyword: l.keyword,
					articleUrl: l.articleUrl
				}))
			: []
	);

	function resetFilters(category: string) {
		activeCategory = category;
		filterType = '';
		searchTerm = '';
		dateRange = { start: undefined, end: undefined };
	}

	// Thumbnail URLs cache with TTL — clear on context switch
	const THUMBNAIL_TTL_MS = 240_000; // 4 min (presigned URLs expire at 5 min)
	let thumbnailCache = $state<Record<string, { url: string; fetchedAt: number }>>({});
	let thumbnailUrls = $derived(Object.fromEntries(Object.entries(thumbnailCache).map(([id, v]) => [id, v.url])));
	const loadingThumbnailIds = $state(new Set<string>());

	$effect(() => {
		void selectedClientIds;
		void activeCategory;
		untrack(() => {
			thumbnailCache = {};
			loadingThumbnailIds.clear();
		});
	});

	$effect(() => {
		const now = Date.now();
		const cache = untrack(() => thumbnailCache);
		const loading = untrack(() => loadingThumbnailIds);
		const mediaMaterials = materials.filter(
			(m: any) => (m.type === 'image' || m.type === 'video') &&
			m.filePath &&
			!loading.has(m.id) &&
			(!cache[m.id] || now - cache[m.id].fetchedAt > THUMBNAIL_TTL_MS)
		);
		for (const m of mediaMaterials) {
			loadingThumbnailIds.add(m.id);
			getMaterialDownloadUrl(m.id)
				.then((r) => {
					untrack(() => {
						thumbnailCache = { ...thumbnailCache, [m.id]: { url: r.url, fetchedAt: Date.now() } };
					});
				})
				.catch(() => {})
				.finally(() => loadingThumbnailIds.delete(m.id));
		}
	});

	function handleEdit(material: any) {
		editMaterial = material;
		editDialogOpen = true;
	}

	function handleDeleteClick(material: any) {
		deleteTarget = material;
		deleteConfirmOpen = true;
	}

	async function handleDeleteConfirm() {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await deleteMarketingMaterial(deleteTarget.id).updates(materialsQuery);
			toast.success('Material șters');
		} catch (e: any) {
			clientLogger.apiError('marketing_delete', e);
		} finally {
			deleting = false;
			deleteConfirmOpen = false;
			deleteTarget = null;
		}
	}

	function handleUploaded() {
		refreshKey++;
	}

	function handleUpdated() {
		refreshKey++;
	}

	// Preview state
	let previewOpen = $state(false);
	let previewMaterial = $state<any>(null);
	let previewUrl = $state<string | null>(null);
	let lightboxOpen = $state(false);
	let lightboxSrc = $state('');

	function handlePreviewNavigate(direction: 'prev' | 'next') {
		if (!previewMaterial) return;
		const idx = displayMaterials.findIndex((m: any) => m.id === previewMaterial.id);
		if (idx === -1) return;
		const newIdx = direction === 'prev'
			? (idx - 1 + displayMaterials.length) % displayMaterials.length
			: (idx + 1) % displayMaterials.length;
		handlePreview(displayMaterials[newIdx]);
	}

	function isValidHttpUrl(value: string): boolean {
		try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
	}

	async function handlePreview(material: any) {
		if (material.type === 'url') {
			// Social URL sets (tiktok/facebook) — always open preview dialog to show all sets
			if (material.textContent) {
				previewMaterial = material;
				previewUrl = null;
				previewOpen = true;
			} else if (material.externalUrl && isValidHttpUrl(material.externalUrl)) {
				window.open(material.externalUrl, '_blank', 'noopener,noreferrer');
			} else {
				clientLogger.warn({ message: 'Materialul nu are conținut de previzualizat', action: 'marketing_preview' });
			}
			return;
		}
		if (material.type === 'image') {
			const url = thumbnailUrls[material.id];
			if (url) {
				lightboxSrc = url;
				lightboxOpen = true;
			} else if (material.filePath) {
				try {
					const result = await getMaterialDownloadUrl(material.id);
					lightboxSrc = result.url;
					lightboxOpen = true;
				} catch (e) {
					clientLogger.apiError('marketing_preview_image', e);
				}
			}
			return;
		}
		if (material.type === 'document') {
			if (material.filePath) {
				try {
					const result = await getMaterialPreviewUrl(material.id);
					previewUrl = result.url;
					previewMaterial = material;
					previewOpen = true;
				} catch (e) {
					clientLogger.apiError('marketing_preview_document', e);
				}
			}
			return;
		}
		if (material.type === 'video') {
			if (material.filePath) {
				try {
					const result = await getMaterialDownloadUrl(material.id);
					previewUrl = result.url;
					previewMaterial = material;
					previewOpen = true;
				} catch (e) {
					clientLogger.apiError('marketing_preview_video', e);
				}
			}
			return;
		}
		if (material.type === 'text') {
			previewMaterial = material;
			previewUrl = null;
			previewOpen = true;
			return;
		}
	}

	const uploadUrl = $derived(`/${tenantSlug}/marketing-materials/upload`);
	const isFileFilterType = $derived(['image', 'video', 'document'].includes(filterType));

	// Active tasks for task picker — scoped to selected clients
	const activeTasksQuery = $derived(getTasks({
		status: ['todo', 'in-progress', 'review', 'pending-approval'],
		...(selectedClientIds.length > 0 && selectedClientIds.length < activeClients.length ? { clientIds: selectedClientIds } : {})
	}));
	const activeTasks = $derived(
		(activeTasksQuery.current || []).map((t: any) => ({ id: t.id, title: t.title, status: t.status, clientId: t.clientId }))
	);

	const linkingIds = new Set<string>();

	async function handleLinkTask(materialId: string, taskId: string) {
		const key = `${materialId}:${taskId}`;
		if (linkingIds.has(key)) return;
		linkingIds.add(key);
		try {
			await linkMaterialToTask({ taskId, materialId }).updates(materialsQuery);
			toast.success('Task asociat');
		} catch (e: any) {
			clientLogger.apiError('marketing_link_task', e);
		} finally {
			linkingIds.delete(key);
		}
	}

	async function handleUnlinkTask(materialId: string, taskId: string) {
		const key = `${materialId}:${taskId}`;
		if (linkingIds.has(key)) return;
		linkingIds.add(key);
		try {
			await unlinkMaterialFromTask({ taskId, materialId }).updates(materialsQuery);
			toast.success('Task dezasociat');
		} catch (e: any) {
			clientLogger.apiError('marketing_unlink_task', e);
		} finally {
			linkingIds.delete(key);
		}
	}

	// Get client name by id
	function getClientName(clientId: string): string {
		const client = clients.find((c: any) => c.id === clientId);
		return client?.name || '';
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<MegaphoneIcon class="h-6 w-6 text-primary" />
			<div>
				<h1 class="text-2xl font-bold tracking-tight">Marketing</h1>
				<p class="text-sm text-muted-foreground">Materiale marketing pentru toate campaniile</p>
			</div>
		</div>
		<div class="flex items-center gap-3">
			<!-- Client filter (multi-select popover) -->
			{#if activeClients.length > 0}
				<Popover bind:open={clientFilterPopoverOpen}>
					<PopoverTrigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="h-9 gap-2 text-sm font-normal">
								<FilterIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
								{#if selectedClientIds.length === 0 || selectedClientIds.length === activeClients.length}
									Toți clienții
								{:else if selectedClientIds.length === 1}
									{getClientName(selectedClientIds[0])}
								{:else}
									{selectedClientIds.length} clienți selectați
								{/if}
								{#if selectedClientIds.length > 0 && selectedClientIds.length < activeClients.length}
									<Badge variant="secondary" class="ml-auto">{selectedClientIds.length}</Badge>
								{/if}
							</Button>
						{/snippet}
					</PopoverTrigger>
					<PopoverContent class="w-72 p-2" align="end">
						<div class="flex items-center justify-between mb-2">
							<p class="text-xs font-medium">Filtrează clienți</p>
							{#if selectedClientIds.length > 0}
								<button class="text-xs text-muted-foreground hover:text-foreground" onclick={clearClientFilter}>
									Resetează
								</button>
							{/if}
						</div>
						<div class="relative mb-2">
							<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
							<Input bind:value={clientFilterSearch} placeholder="Caută client..." class="pl-8 h-8 text-sm" />
						</div>
						<div class="flex gap-1.5 mb-2">
							<Button variant="outline" size="sm" class="flex-1" onclick={selectAllClients}>
								Selectează toți
							</Button>
							<Button variant="outline" size="sm" class="flex-1" onclick={clearClientFilter}>
								Deselectează toți
							</Button>
						</div>
						<p class="text-xs text-muted-foreground mb-1">
							{selectedClientIds.length === 0 || selectedClientIds.length === activeClients.length
								? 'Toți clienții afișați'
								: `${selectedClientIds.length} din ${activeClients.length} selectați`}
						</p>
						<div class="max-h-[200px] overflow-y-auto space-y-0.5">
							{#each popoverClients as client (client.id)}
								<div class="flex items-center space-x-2 rounded px-1 py-1 hover:bg-muted/50">
									<Checkbox
										checked={selectedClientIds.includes(client.id)}
										onCheckedChange={() => toggleClient(client.id)}
										id={`mkt-client-${client.id}`}
									/>
									<Label for={`mkt-client-${client.id}`} class="cursor-pointer flex-1 truncate text-sm font-normal">
										{client.name}
									</Label>
								</div>
							{/each}
						</div>
					</PopoverContent>
				</Popover>
			{/if}

			<!-- Collection filter -->
			<CollectionManager
				clientId={uploadClientId}
				clientIds={selectedClientIds}
				bind:activeCollectionId
				selectedMaterialIds={selectedIds}
			/>

			{#if activeCategory !== 'all'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props}>
								<PlusIcon class="h-4 w-4 mr-2" />
								Adaugă Material
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-72">
						<DropdownMenu.Item onclick={() => {
							if (selectedClientIds.length !== 1) { clientLogger.warn({ message: 'Selectează un singur client mai întâi', action: 'marketing_add_material' }); return; }
							uploadDialogOpen = true;
						}}>
							<UploadIcon class="h-4 w-4 mr-2" />
							Încarcă fișier
							<span class="ml-auto text-xs text-muted-foreground">Imagine, video, doc</span>
						</DropdownMenu.Item>

						{#if activeCategory === 'google-ads'}
							<DropdownMenu.Item onclick={() => {
								if (selectedClientIds.length !== 1) { clientLogger.warn({ message: 'Selectează un singur client mai întâi', action: 'marketing_add_material' }); return; }
								googleAdsDialogOpen = true;
							}}>
								<GoogleAdsIcon class="h-4 w-4 mr-2" />
								Google Ads Assets
								<span class="ml-auto text-xs text-muted-foreground">Text + imagini</span>
							</DropdownMenu.Item>
						{/if}

						{#if activeCategory === 'tiktok-ads' || activeCategory === 'facebook-ads'}
							<DropdownMenu.Item onclick={() => {
								if (selectedClientIds.length !== 1) { clientLogger.warn({ message: 'Selectează un singur client mai întâi', action: 'marketing_add_material' }); return; }
								socialUrlDialogOpen = true;
							}}>
								<LinkIcon class="h-4 w-4 mr-2" />
								Seturi URL-uri
								<span class="ml-auto text-xs text-muted-foreground">Link-uri campanii</span>
							</DropdownMenu.Item>
						{/if}

						{#if activeCategory === 'press-article' || activeCategory === 'seo-article'}
							<DropdownMenu.Item onclick={() => {
								if (selectedClientIds.length !== 1) { clientLogger.warn({ message: 'Selectează un singur client mai întâi', action: 'marketing_add_material' }); return; }
								articleDialogOpen = true;
							}}>
								<NewspaperIcon class="h-4 w-4 mr-2" />
								Articol
								<span class="ml-auto text-xs text-muted-foreground">Document + imagini</span>
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</div>

	<!-- Category tabs -->
	<Tabs value={activeCategory} class="w-full">
		<TabsList class="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
			<TabsTrigger value="all" onclick={() => resetFilters('all')}>
				<Layers3Icon class="h-4 w-4 mr-1.5 shrink-0" /> Toate
			</TabsTrigger>
			<TabsTrigger value="google-ads" onclick={() => resetFilters('google-ads')}>
				<GoogleAdsIcon class="h-4 w-4 mr-1.5 shrink-0" /> Google Ads
			</TabsTrigger>
			<TabsTrigger value="facebook-ads" onclick={() => resetFilters('facebook-ads')}>
				<FacebookIcon class="h-4 w-4 mr-1.5 shrink-0" /> Facebook Ads
			</TabsTrigger>
			<TabsTrigger value="tiktok-ads" onclick={() => resetFilters('tiktok-ads')}>
				<TiktokIcon class="h-4 w-4 mr-1.5 shrink-0" /> TikTok Ads
			</TabsTrigger>
			<TabsTrigger value="press-article" onclick={() => resetFilters('press-article')}>
				<NewspaperIcon class="h-4 w-4 mr-1.5 shrink-0" /> Articole Presă
			</TabsTrigger>
			<TabsTrigger value="seo-article" onclick={() => resetFilters('seo-article')}>
				<SearchIcon class="h-4 w-4 mr-1.5 shrink-0" /> Articole SEO
			</TabsTrigger>
		</TabsList>

		<TabsContent value={activeCategory} class="mt-4 space-y-4">
			<!-- Filters + view toggle -->
			<MaterialFilters bind:filterType bind:searchTerm bind:viewMode bind:dateRange {activeCategory} {materials} />

			<!-- Inline upload zone for file type filters -->
			{#if isFileFilterType && uploadClientId && activeCategory !== 'all'}
				<MaterialInlineUpload
					filterType={filterType as 'image' | 'video' | 'document'}
					category={activeCategory}
					clientId={uploadClientId}
					{uploadUrl}
					onUploaded={handleUploaded}
				/>
			{/if}

			<!-- Loading -->
			{#if loading}
				<MaterialSkeleton />
			{:else}
			<!-- Stats + Batch actions -->
			<div class="flex items-center gap-3 text-sm text-muted-foreground">
				{#if displayMaterials.length > 0}
					<Checkbox
						checked={allSelected}
						onCheckedChange={toggleSelectAll}
						aria-label="Selectează toate"
					/>
				{/if}
				{#if selectedCount > 0}
					<span class="font-medium text-foreground">{selectedCount} selectate</span>
					<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={clearSelection}>Deselectează</Button>
					<Button variant="destructive" size="sm" class="h-7 text-xs" onclick={handleBatchDelete} disabled={batchDeleting}>
						{batchDeleting ? 'Se șterge...' : `Șterge (${selectedCount})`}
					</Button>
				{:else}
					<span>{displayMaterials.length} materiale</span>
					{#if displayMaterials.length > 0}
						{@const totalSize = displayMaterials.reduce((acc: number, m: any) => acc + (m.fileSize || 0), 0)}
						{#if totalSize > 0}
							<span>·</span>
							<span>{(totalSize / (1024 * 1024)).toFixed(1)} MB total</span>
						{/if}
					{/if}
				{/if}
			</div>

			<!-- Content -->
			{#if displayMaterials.length === 0}
				<div class="text-center py-12 text-muted-foreground">
					<MegaphoneIcon class="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p class="text-sm">{materials.length === 0 ? 'Niciun material în această categorie.' : 'Niciun material nu corespunde filtrelor aplicate.'}</p>
					{#if !isFileFilterType && uploadClientId && activeCategory !== 'all'}
						<Button variant="outline" class="mt-3" onclick={() => {
							if (activeCategory === 'google-ads') { googleAdsDialogOpen = true; }
							else if (activeCategory === 'tiktok-ads' || activeCategory === 'facebook-ads') { socialUrlDialogOpen = true; }
							else if (activeCategory === 'press-article' || activeCategory === 'seo-article') { articleDialogOpen = true; }
							else { uploadDialogOpen = true; }
						}}>
							<PlusIcon class="h-4 w-4 mr-2" />
							Adaugă primul material
						</Button>
					{/if}
				</div>
			{:else if activeCategory === 'all'}
				<MaterialGroupedView
					materials={displayMaterials}
					{thumbnailUrls}
					{viewMode}
					clientNameFn={selectedClientIds.length !== 1 ? getClientName : undefined}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
					onPreview={handlePreview}
					{activeTasks}
					onLinkTask={handleLinkTask}
					onUnlinkTask={handleUnlinkTask}
				/>
			{:else if viewMode === 'list'}
				<MaterialListView
					materials={displayMaterials}
					clientNameFn={selectedClientIds.length !== 1 ? getClientName : undefined}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
					onPreview={handlePreview}
					{activeTasks}
					onLinkTask={handleLinkTask}
					onUnlinkTask={handleUnlinkTask}
				/>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each displayMaterials as material (material.id)}
						<div class="relative group/select">
							{#if selectedClientIds.length !== 1}
								<p class="text-xs text-muted-foreground mb-1 truncate">{getClientName(material.clientId)}</p>
							{/if}
							<div class="absolute top-1 left-1 z-10 {selectedIds.has(material.id) ? 'opacity-100' : 'opacity-0 group-hover/select:opacity-100'} transition-opacity">
								<Checkbox
									checked={selectedIds.has(material.id)}
									onCheckedChange={() => toggleSelect(material.id)}
									class="bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded"
								/>
							</div>
							<div class={selectedIds.has(material.id) ? 'ring-2 ring-primary rounded-lg' : ''}>
								<MaterialCard
									{material}
									thumbnailUrl={thumbnailUrls[material.id] || null}
									onEdit={handleEdit}
									onDelete={handleDeleteClick}
									onPreview={handlePreview}
									{activeTasks}
									onLinkTask={handleLinkTask}
									onUnlinkTask={handleUnlinkTask}
								/>
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{/if}
		</TabsContent>
	</Tabs>
</div>

<!-- Upload Dialog (requires single client selected) -->
{#if uploadClientId}
	<MaterialUploadDialog
		bind:open={uploadDialogOpen}
		category={activeCategory}
		clientId={uploadClientId}
		{uploadUrl}
		{seoLinks}
		onUploaded={handleUploaded}
		initialType={filterType === 'url' ? 'url' : filterType === 'text' ? 'text' : undefined}
	/>

	<!-- Google Ads Asset Dialog -->
	<GoogleAdsAssetDialog
		bind:open={googleAdsDialogOpen}
		clientId={uploadClientId}
		{uploadUrl}
		onSaved={handleUploaded}
	/>

	<!-- Social URL Dialog (TikTok / Facebook) -->
	<SocialUrlDialog
		bind:open={socialUrlDialogOpen}
		clientId={uploadClientId}
		category={activeCategory as 'tiktok-ads' | 'facebook-ads'}
		onSaved={handleUploaded}
	/>

	<!-- Article Upload Dialog (Press / SEO) -->
	<ArticleUploadDialog
		bind:open={articleDialogOpen}
		category={activeCategory}
		clientId={uploadClientId}
		{uploadUrl}
		onUploaded={handleUploaded}
	/>
{/if}

<!-- Edit Dialog -->
<MaterialEditDialog
	bind:open={editDialogOpen}
	material={editMaterial}
	seoLinks={editSeoLinks}
	onUpdated={handleUpdated}
/>

<!-- Image Lightbox -->
<ImageLightbox
	src={lightboxSrc}
	alt={previewMaterial?.title || ''}
	open={lightboxOpen}
	onClose={() => { lightboxOpen = false; }}
/>

<!-- Preview Dialog (video, text, Google Ads, social URLs) -->
<MaterialPreviewDialog
	bind:open={previewOpen}
	material={previewMaterial}
	presignedUrl={previewUrl}
	onNavigate={handlePreviewNavigate}
/>

<!-- Delete Confirmation -->
<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="sm:max-w-md max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Confirmare ștergere</Dialog.Title>
			<Dialog.Description>
				Sigur vrei să ștergi materialul "{deleteTarget?.title}"? Acțiunea este ireversibilă.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteConfirmOpen = false)}>Anulează</Button>
			<Button variant="destructive" onclick={handleDeleteConfirm} disabled={deleting}>
				{deleting ? 'Se șterge...' : 'Șterge'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
