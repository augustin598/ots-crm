<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import SearchIcon from '@lucide/svelte/icons/search';
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
	import ArticleUploadDialog from '$lib/components/marketing/article-upload-dialog.svelte';
	import MaterialGroupedView from '$lib/components/marketing/material-grouped-view.svelte';
	import { getMarketingMaterials, deleteMarketingMaterial, getMaterialDownloadUrl } from '$lib/remotes/marketing-materials.remote';
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { DateRange } from 'bits-ui';

	const tenantSlug = $derived(page.params.tenant as string);
	// clientId is auto-scoped by the remote for client users
	const clientId = $derived((page.data as any)?.client?.id || '');
	const currentClientUserId = $derived((page.data as any)?.clientUser?.id || null);

	let activeCategory = $state('all');
	let filterType = $state('');
	let searchTerm = $state('');
	let dateRange = $state<DateRange>({ start: undefined, end: undefined });
	let refreshKey = $state(0);
	let uploadDialogOpen = $state(false);
	let googleAdsDialogOpen = $state(false);
	let articleDialogOpen = $state(false);
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

	const materialsQuery = $derived(
		getMarketingMaterials({
			category: activeCategory === 'all' ? undefined : activeCategory,
			type: filterType || undefined,
			search: searchTerm.trim() || undefined,
			_refresh: refreshKey
		} as any)
	);
	const materials = $derived(materialsQuery.current || []);
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

	// SEO links for the seo-article combobox
	const seoLinksQuery = $derived(getSeoLinks({ clientId: clientId || undefined }));
	const seoLinks = $derived(
		(seoLinksQuery.current || []).map((l: any) => ({
			id: l.id,
			keyword: l.keyword,
			articleUrl: l.articleUrl
		}))
	);

	// Thumbnail URLs cache with TTL — clear on category switch
	const THUMBNAIL_TTL_MS = 240_000; // 4 min (presigned URLs expire at 5 min)
	let thumbnailCache = $state<Record<string, { url: string; fetchedAt: number }>>({});
	let thumbnailUrls = $derived(Object.fromEntries(Object.entries(thumbnailCache).map(([id, v]) => [id, v.url])));
	const loadingThumbnailIds = new Set<string>();

	$effect(() => {
		void activeCategory;
		thumbnailCache = {};
		loadingThumbnailIds.clear();
	});

	$effect(() => {
		const now = Date.now();
		const mediaMaterials = materials.filter(
			(m: any) => (m.type === 'image' || m.type === 'video') && m.filePath && !loadingThumbnailIds.has(m.id) && (!thumbnailCache[m.id] || now - thumbnailCache[m.id].fetchedAt > THUMBNAIL_TTL_MS)
		);
		for (const m of mediaMaterials) {
			loadingThumbnailIds.add(m.id);
			getMaterialDownloadUrl(m.id)
				.then((r) => {
					thumbnailCache = { ...thumbnailCache, [m.id]: { url: r.url, fetchedAt: Date.now() } };
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
		if (!deleteTarget) return;
		deleting = true;
		try {
			await deleteMarketingMaterial(deleteTarget.id).updates(materialsQuery);
			toast.success('Material șters');
			deleteConfirmOpen = false;
			deleteTarget = null;
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la ștergere');
			deleteConfirmOpen = false;
			deleteTarget = null;
		} finally {
			deleting = false;
		}
	}

	function handleUploaded() {
		refreshKey++;
	}

	function handleUpdated() {
		refreshKey++;
	}

	const uploadUrl = $derived(`/client/${tenantSlug}/marketing/upload`);
	const isFileFilterType = $derived(['image', 'video', 'document'].includes(filterType));
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<MegaphoneIcon class="h-6 w-6 text-primary" />
			<h2 class="text-xl font-semibold">Materiale Marketing</h2>
		</div>
		{#if !isFileFilterType && activeCategory !== 'all'}
			<Button onclick={() => {
				if (activeCategory === 'google-ads') { googleAdsDialogOpen = true; }
				else if (activeCategory === 'press-article' || activeCategory === 'seo-article') { articleDialogOpen = true; }
				else { uploadDialogOpen = true; }
			}}>
				<PlusIcon class="h-4 w-4 mr-2" />
				Adaugă Material
			</Button>
		{/if}
	</div>

	<!-- Category tabs -->
	<Tabs value={activeCategory} class="w-full">
		<TabsList class="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
			<TabsTrigger value="all" onclick={() => { activeCategory = 'all'; filterType = ''; searchTerm = ''; dateRange = { start: undefined, end: undefined }; }}>
				<Layers3Icon class="h-4 w-4 mr-1.5 shrink-0" /> Toate
			</TabsTrigger>
			<TabsTrigger value="google-ads" onclick={() => { activeCategory = 'google-ads'; filterType = ''; searchTerm = ''; dateRange = { start: undefined, end: undefined }; }}>
				<GoogleAdsIcon class="h-4 w-4 mr-1.5 shrink-0" /> Google Ads
			</TabsTrigger>
			<TabsTrigger value="facebook-ads" onclick={() => { activeCategory = 'facebook-ads'; filterType = ''; searchTerm = ''; dateRange = { start: undefined, end: undefined }; }}>
				<FacebookIcon class="h-4 w-4 mr-1.5 shrink-0" /> Facebook Ads
			</TabsTrigger>
			<TabsTrigger value="tiktok-ads" onclick={() => { activeCategory = 'tiktok-ads'; filterType = ''; searchTerm = ''; dateRange = { start: undefined, end: undefined }; }}>
				<TiktokIcon class="h-4 w-4 mr-1.5 shrink-0" /> TikTok Ads
			</TabsTrigger>
			<TabsTrigger value="press-article" onclick={() => { activeCategory = 'press-article'; filterType = ''; searchTerm = ''; dateRange = { start: undefined, end: undefined }; }}>
				<NewspaperIcon class="h-4 w-4 mr-1.5 shrink-0" /> Articole Presă
			</TabsTrigger>
			<TabsTrigger value="seo-article" onclick={() => { activeCategory = 'seo-article'; filterType = ''; searchTerm = ''; dateRange = { start: undefined, end: undefined }; }}>
				<SearchIcon class="h-4 w-4 mr-1.5 shrink-0" /> Articole SEO
			</TabsTrigger>
		</TabsList>

		<TabsContent value={activeCategory} class="mt-4 space-y-4">
			<!-- Filters + view toggle -->
			<MaterialFilters bind:filterType bind:searchTerm bind:viewMode bind:dateRange />

			<!-- Inline upload zone for file type filters -->
			{#if isFileFilterType && clientId && activeCategory !== 'all'}
				<MaterialInlineUpload
					filterType={filterType as 'image' | 'video' | 'document'}
					category={activeCategory}
					{clientId}
					{uploadUrl}
					onUploaded={handleUploaded}
				/>
			{/if}

			<!-- Stats -->
			<div class="flex items-center gap-3 text-sm text-muted-foreground">
				<span>{filteredMaterials.length} materiale</span>
				{#if filteredMaterials.length > 0}
					{@const totalSize = filteredMaterials.reduce((acc: number, m: any) => acc + (m.fileSize || 0), 0)}
					{#if totalSize > 0}
						<span>·</span>
						<span>{(totalSize / (1024 * 1024)).toFixed(1)} MB total</span>
					{/if}
				{/if}
			</div>

			<!-- Content -->
			{#if filteredMaterials.length === 0}
				<div class="text-center py-12 text-muted-foreground">
					<MegaphoneIcon class="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p class="text-sm">Niciun material în această categorie.</p>
					{#if !isFileFilterType && activeCategory !== 'all'}
						<Button variant="outline" class="mt-3" onclick={() => {
							if (activeCategory === 'google-ads') { googleAdsDialogOpen = true; }
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
					materials={filteredMaterials}
					{thumbnailUrls}
					{viewMode}
					{currentClientUserId}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
				/>
			{:else if viewMode === 'list'}
				<MaterialListView
					materials={filteredMaterials}
					{currentClientUserId}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
				/>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each filteredMaterials as material (material.id)}
						<MaterialCard
							{material}
							thumbnailUrl={thumbnailUrls[material.id] || null}
							{currentClientUserId}
							onEdit={handleEdit}
							onDelete={handleDeleteClick}
						/>
					{/each}
				</div>
			{/if}
		</TabsContent>
	</Tabs>
</div>

<!-- Upload Dialog -->
{#if clientId}
	<MaterialUploadDialog
		bind:open={uploadDialogOpen}
		category={activeCategory}
		{clientId}
		{uploadUrl}
		{seoLinks}
		onUploaded={handleUploaded}
		initialType={filterType === 'url' ? 'url' : filterType === 'text' ? 'text' : undefined}
	/>

	<!-- Google Ads Asset Dialog -->
	<GoogleAdsAssetDialog
		bind:open={googleAdsDialogOpen}
		{clientId}
		{uploadUrl}
		onSaved={handleUploaded}
	/>

	<!-- Article Upload Dialog (Press / SEO) -->
	<ArticleUploadDialog
		bind:open={articleDialogOpen}
		category={activeCategory}
		{clientId}
		{uploadUrl}
		onUploaded={handleUploaded}
	/>
{/if}

<!-- Edit Dialog -->
<MaterialEditDialog
	bind:open={editDialogOpen}
	material={editMaterial}
	{seoLinks}
	onUpdated={handleUpdated}
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
