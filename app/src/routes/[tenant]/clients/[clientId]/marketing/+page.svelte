<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import LoaderIcon from '@lucide/svelte/icons/loader';
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
	import SocialUrlDialog from '$lib/components/marketing/social-url-dialog.svelte';
	import ArticleUploadDialog from '$lib/components/marketing/article-upload-dialog.svelte';
	import MaterialGroupedView from '$lib/components/marketing/material-grouped-view.svelte';
	import ImageLightbox from '$lib/components/image-lightbox.svelte';
	import MaterialPreviewDialog from '$lib/components/marketing/material-preview-dialog.svelte';
	import { getMarketingMaterials, deleteMarketingMaterial, getMaterialDownloadUrl, getMaterialPreviewUrl } from '$lib/remotes/marketing-materials.remote';
	import { linkMaterialToTask, unlinkMaterialFromTask } from '$lib/remotes/task-materials.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { DateRange } from 'bits-ui';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	let activeCategory = $state('all');
	let filterType = $state('');
	let searchTerm = $state('');
	let dateRange = $state<DateRange>({ start: undefined, end: undefined });
	let refreshKey = $state(0);
	let uploadDialogOpen = $state(false);
	let googleAdsDialogOpen = $state(false);
	let socialUrlDialogOpen = $state(false);
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
			clientId,
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

	// SEO links for the seo-article combobox
	const seoLinksQuery = $derived(getSeoLinks({ clientId }));
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
			clientLogger.apiError('marketing_delete', e);
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

	// Preview state
	let previewOpen = $state(false);
	let previewMaterial = $state<any>(null);
	let previewUrl = $state<string | null>(null);
	let lightboxOpen = $state(false);
	let lightboxSrc = $state('');

	async function handlePreview(material: any) {
		if (material.type === 'url') {
			if (material.externalUrl) {
				window.open(material.externalUrl, '_blank', 'noopener,noreferrer');
			} else if (material.textContent) {
				previewMaterial = material;
				previewUrl = null;
				previewOpen = true;
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
				} catch {
					clientLogger.error({ message: 'Eroare la încărcarea imaginii', action: 'marketing_preview_image' });
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
				} catch {
					clientLogger.error({ message: 'Eroare la deschiderea documentului', action: 'marketing_preview_document' });
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
				} catch {
					clientLogger.error({ message: 'Eroare la încărcarea videoclipului', action: 'marketing_preview_video' });
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

	// Active tasks for task picker (scoped to this client)
	const activeTasksQuery = $derived(getTasks({ clientId, status: ['todo', 'in-progress', 'review', 'pending-approval'] }));
	const activeTasks = $derived(
		(activeTasksQuery.current || []).map((t: any) => ({ id: t.id, title: t.title, status: t.status, clientId: t.clientId }))
	);

	async function handleLinkTask(materialId: string, taskId: string) {
		try {
			await linkMaterialToTask({ taskId, materialId }).updates(materialsQuery);
			toast.success('Task asociat');
		} catch (e: any) {
			clientLogger.apiError('marketing_link_task', e);
		}
	}

	async function handleUnlinkTask(materialId: string, taskId: string) {
		try {
			await unlinkMaterialFromTask({ taskId, materialId }).updates(materialsQuery);
			toast.success('Task dezasociat');
		} catch (e: any) {
			clientLogger.apiError('marketing_unlink_task', e);
		}
	}
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
				else if (activeCategory === 'tiktok-ads' || activeCategory === 'facebook-ads') { socialUrlDialogOpen = true; }
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
		<TabsList class="grid w-full grid-cols-3 sm:grid-cols-6">
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
			<!-- Filters -->
			<MaterialFilters bind:filterType bind:searchTerm bind:viewMode bind:dateRange />

			<!-- Inline upload zone for file type filters -->
			{#if isFileFilterType && activeCategory !== 'all'}
				<MaterialInlineUpload
					filterType={filterType as 'image' | 'video' | 'document'}
					category={activeCategory}
					{clientId}
					{uploadUrl}
					onUploaded={handleUploaded}
				/>
			{/if}

			<!-- Loading -->
			{#if loading}
				<div class="flex items-center justify-center py-12">
					<LoaderIcon class="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			{:else}
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
					materials={filteredMaterials}
					{thumbnailUrls}
					{viewMode}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
					onPreview={handlePreview}
					{activeTasks}
					onLinkTask={handleLinkTask}
					onUnlinkTask={handleUnlinkTask}
				/>
			{:else if viewMode === 'list'}
				<MaterialListView
					materials={filteredMaterials}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
					onPreview={handlePreview}
					{activeTasks}
					onLinkTask={handleLinkTask}
					onUnlinkTask={handleUnlinkTask}
				/>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each filteredMaterials as material (material.id)}
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
					{/each}
				</div>
			{/if}
			{/if}
		</TabsContent>
	</Tabs>
</div>

<!-- Upload Dialog -->
<MaterialUploadDialog
	bind:open={uploadDialogOpen}
	category={activeCategory}
	{clientId}
	{uploadUrl}
	{seoLinks}
	onUploaded={handleUploaded}
/>

<!-- Google Ads Asset Dialog -->
<GoogleAdsAssetDialog
	bind:open={googleAdsDialogOpen}
	{clientId}
	{uploadUrl}
	onSaved={handleUploaded}
/>

<!-- Social URL Dialog -->
<SocialUrlDialog
	bind:open={socialUrlDialogOpen}
	{clientId}
	category={activeCategory as 'tiktok-ads' | 'facebook-ads'}
	onSaved={handleUploaded}
/>

<!-- Article Upload Dialog -->
<ArticleUploadDialog
	bind:open={articleDialogOpen}
	category={activeCategory}
	{clientId}
	{uploadUrl}
	onUploaded={handleUploaded}
/>

<!-- Edit Dialog -->
<MaterialEditDialog
	bind:open={editDialogOpen}
	material={editMaterial}
	{seoLinks}
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
