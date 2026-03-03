<script lang="ts">
	import { page } from '$app/state';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import SearchIcon from '@lucide/svelte/icons/search';
	import GoogleAdsIcon from '$lib/components/marketing/icon-google-ads.svelte';
	import FacebookIcon from '$lib/components/marketing/icon-facebook.svelte';
	import TiktokIcon from '$lib/components/marketing/icon-tiktok.svelte';
	import MaterialCard from '$lib/components/marketing/material-card.svelte';
	import MaterialFilters from '$lib/components/marketing/material-filters.svelte';
	import MaterialUploadDialog from '$lib/components/marketing/material-upload-dialog.svelte';
	import MaterialEditDialog from '$lib/components/marketing/material-edit-dialog.svelte';
	import { getMarketingMaterials, deleteMarketingMaterial, getMaterialDownloadUrl } from '$lib/remotes/marketing-materials.remote';
	import { getSeoLinks } from '$lib/remotes/seo-links.remote';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';

	const tenantSlug = $derived(page.params.tenant as string);
	// clientId is auto-scoped by the remote for client users
	const clientId = $derived((page.data as any)?.client?.id || '');
	const currentClientUserId = $derived((page.data as any)?.clientUser?.id || null);

	let activeCategory = $state('google-ads');
	let filterType = $state('');
	let searchTerm = $state('');
	let uploadDialogOpen = $state(false);
	let editDialogOpen = $state(false);
	let editMaterial = $state<any>(null);
	let deleteConfirmOpen = $state(false);
	let deleteTarget = $state<any>(null);
	let deleting = $state(false);

	const categories = [
		{ id: 'google-ads', label: 'Google Ads' },
		{ id: 'facebook-ads', label: 'Facebook Ads' },
		{ id: 'tiktok-ads', label: 'TikTok Ads' },
		{ id: 'press-article', label: 'Articole Presă' },
		{ id: 'seo-article', label: 'Articole SEO' }
	];

	const materialsQuery = $derived(
		getMarketingMaterials({
			category: activeCategory,
			type: filterType || undefined,
			search: searchTerm.trim() || undefined
		})
	);
	const materials = $derived(materialsQuery.current || []);

	// SEO links for the seo-article combobox
	const seoLinksQuery = $derived(getSeoLinks({}));
	const seoLinks = $derived(
		(seoLinksQuery.current || []).map((l: any) => ({
			id: l.id,
			keyword: l.keyword,
			articleUrl: l.articleUrl
		}))
	);

	// Thumbnail URLs cache
	let thumbnailUrls = $state<Record<string, string>>({});
	const loadingThumbnailIds = new Set<string>();

	$effect(() => {
		const imageMaterials = materials.filter(
			(m: any) => m.type === 'image' && m.filePath && !thumbnailUrls[m.id] && !loadingThumbnailIds.has(m.id)
		);
		for (const m of imageMaterials) {
			loadingThumbnailIds.add(m.id);
			getMaterialDownloadUrl(m.id)
				.then((r) => {
					thumbnailUrls = { ...thumbnailUrls, [m.id]: r.url };
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
		} finally {
			deleting = false;
		}
	}

	function handleUploaded() {
		materialsQuery.revalidate();
	}

	function handleUpdated() {
		materialsQuery.revalidate();
	}

	const uploadUrl = $derived(`/client/${tenantSlug}/marketing/upload`);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<MegaphoneIcon class="h-6 w-6 text-primary" />
			<h2 class="text-xl font-semibold">Materiale Marketing</h2>
		</div>
		<Button onclick={() => (uploadDialogOpen = true)}>
			<PlusIcon class="h-4 w-4 mr-2" />
			Adaugă Material
		</Button>
	</div>

	<!-- Category tabs -->
	<Tabs value={activeCategory} class="w-full">
		<TabsList class="grid w-full grid-cols-5">
			<TabsTrigger value="google-ads" onclick={() => { activeCategory = 'google-ads'; filterType = ''; searchTerm = ''; }}>
				<GoogleAdsIcon class="h-4 w-4 mr-1.5 shrink-0" /> Google Ads
			</TabsTrigger>
			<TabsTrigger value="facebook-ads" onclick={() => { activeCategory = 'facebook-ads'; filterType = ''; searchTerm = ''; }}>
				<FacebookIcon class="h-4 w-4 mr-1.5 shrink-0" /> Facebook Ads
			</TabsTrigger>
			<TabsTrigger value="tiktok-ads" onclick={() => { activeCategory = 'tiktok-ads'; filterType = ''; searchTerm = ''; }}>
				<TiktokIcon class="h-4 w-4 mr-1.5 shrink-0" /> TikTok Ads
			</TabsTrigger>
			<TabsTrigger value="press-article" onclick={() => { activeCategory = 'press-article'; filterType = ''; searchTerm = ''; }}>
				<NewspaperIcon class="h-4 w-4 mr-1.5 shrink-0" /> Articole Presă
			</TabsTrigger>
			<TabsTrigger value="seo-article" onclick={() => { activeCategory = 'seo-article'; filterType = ''; searchTerm = ''; }}>
				<SearchIcon class="h-4 w-4 mr-1.5 shrink-0" /> Articole SEO
			</TabsTrigger>
		</TabsList>

		<TabsContent value={activeCategory} class="mt-4 space-y-4">
			<!-- Filters -->
			<MaterialFilters bind:filterType bind:searchTerm />

			<!-- Stats -->
			<div class="flex items-center gap-3 text-sm text-muted-foreground">
				<span>{materials.length} materiale</span>
				{#if materials.length > 0}
					{@const totalSize = materials.reduce((acc: number, m: any) => acc + (m.fileSize || 0), 0)}
					{#if totalSize > 0}
						<span>·</span>
						<span>{(totalSize / (1024 * 1024)).toFixed(1)} MB total</span>
					{/if}
				{/if}
			</div>

			<!-- Grid -->
			{#if materials.length === 0}
				<div class="text-center py-12 text-muted-foreground">
					<MegaphoneIcon class="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p class="text-sm">Niciun material în această categorie.</p>
					<Button variant="outline" class="mt-3" onclick={() => (uploadDialogOpen = true)}>
						<PlusIcon class="h-4 w-4 mr-2" />
						Adaugă primul material
					</Button>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each materials as material (material.id)}
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
	<Dialog.Content class="sm:max-w-md">
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
