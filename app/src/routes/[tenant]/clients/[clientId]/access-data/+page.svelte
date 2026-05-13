<script lang="ts">
	import { page } from '$app/state';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { browser } from '$app/environment';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ServerIcon from '@lucide/svelte/icons/server';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import FacebookIcon from '$lib/components/marketing/icon-facebook.svelte';
	import TiktokIcon from '$lib/components/marketing/icon-tiktok.svelte';
	import InstagramIcon from '@lucide/svelte/icons/instagram';
	import CircleEllipsisIcon from '@lucide/svelte/icons/circle-ellipsis';
	import AccessDataEntryCard from '$lib/components/access-data/access-data-entry-card.svelte';
	import AccessDataListView from '$lib/components/access-data/access-data-list-view.svelte';
	import AccessDataEntryDialog from '$lib/components/access-data/access-data-entry-dialog.svelte';
	import { getAccessData, deleteAccessData } from '$lib/remotes/client-access-data.remote';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';

	const clientId = $derived(page.params.clientId as string);

	const CATEGORIES = [
		{ id: 'website', label: 'Website', icon: GlobeIcon },
		{ id: 'email', label: 'Email', icon: MailIcon },
		{ id: 'cpanel', label: 'cPanel', icon: ServerIcon },
		{ id: 'hosting', label: 'Hosting', icon: HardDriveIcon },
		{ id: 'tiktok', label: 'TikTok', icon: TiktokIcon },
		{ id: 'facebook', label: 'Facebook', icon: FacebookIcon },
		{ id: 'instagram', label: 'Instagram', icon: InstagramIcon },
		{ id: 'google', label: 'Google', icon: GlobeIcon },
		{ id: 'altele', label: 'Altele', icon: CircleEllipsisIcon }
	];

	let activeCategory = $state('website');
	let refreshKey = $state(0);
	let viewMode = $state<'grid' | 'list'>(
		browser ? (localStorage.getItem('access-data-view-mode') as 'grid' | 'list') || 'grid' : 'grid'
	);

	$effect(() => {
		if (browser) {
			localStorage.setItem('access-data-view-mode', viewMode);
		}
	});

	let entryDialogOpen = $state(false);
	let editEntry = $state<any>(null);
	let deleteConfirmOpen = $state(false);
	let deleteTarget = $state<any>(null);
	let deleting = $state(false);

	const dataQuery = $derived(
		getAccessData({
			clientId,
			category: activeCategory,
			_refresh: refreshKey
		} as any)
	);
	const entries = $derived(dataQuery.current || []);

	function handleCreate() {
		editEntry = null;
		entryDialogOpen = true;
	}

	function handleEdit(entry: any) {
		editEntry = entry;
		entryDialogOpen = true;
	}

	function handleDeleteClick(entry: any) {
		deleteTarget = entry;
		deleteConfirmOpen = true;
	}

	async function handleDeleteConfirm() {
		if (!deleteTarget) return;
		deleting = true;
		try {
			await deleteAccessData(deleteTarget.id);
			toast.success('Înregistrare ștearsă');
			deleteConfirmOpen = false;
			deleteTarget = null;
			refreshKey++;
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la ștergere');
		} finally {
			deleting = false;
		}
	}

	function handleSaved() {
		refreshKey++;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<KeyRoundIcon class="h-6 w-6 text-primary" />
			<h2 class="text-xl font-semibold">Date de acces</h2>
		</div>
		<div class="flex items-center gap-3">
			<div class="flex items-center gap-0.5 border rounded-md p-0.5">
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
			<Button onclick={handleCreate}>
				<PlusIcon class="h-4 w-4 mr-2" />
				Adaugă
			</Button>
		</div>
	</div>

	<Tabs value={activeCategory} class="w-full">
		<div class="overflow-x-auto">
			<TabsList class="inline-flex w-full min-w-max">
				{#each CATEGORIES as cat}
					<TabsTrigger
						value={cat.id}
						class="flex-1 gap-1.5"
						onclick={() => { activeCategory = cat.id; }}
					>
						{@const Icon = cat.icon}<Icon class="h-4 w-4" />
						{cat.label}
					</TabsTrigger>
				{/each}
			</TabsList>
		</div>

		<TabsContent value={activeCategory} class="mt-4">
			{#if entries.length === 0}
				<div class="text-center py-12 text-muted-foreground">
					<KeyRoundIcon class="h-12 w-12 mx-auto mb-3 opacity-30" />
					<p class="text-sm">Nicio înregistrare în această categorie.</p>
					<Button variant="outline" class="mt-3" onclick={handleCreate}>
						<PlusIcon class="h-4 w-4 mr-2" />
						Adaugă prima înregistrare
					</Button>
				</div>
			{:else if viewMode === 'grid'}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each entries as entry (entry.id)}
						<AccessDataEntryCard
							{entry}
							currentClientUserId={null}
							isClientUser={false}
							onEdit={handleEdit}
							onDelete={handleDeleteClick}
						/>
					{/each}
				</div>
			{:else}
				<AccessDataListView
					{entries}
					currentClientUserId={null}
					isClientUser={false}
					onEdit={handleEdit}
					onDelete={handleDeleteClick}
				/>
			{/if}
		</TabsContent>
	</Tabs>
</div>

<AccessDataEntryDialog
	bind:open={entryDialogOpen}
	{clientId}
	category={activeCategory}
	entry={editEntry}
	onSaved={handleSaved}
/>

<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="sm:max-w-md max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Confirmare ștergere</Dialog.Title>
			<Dialog.Description>
				Sigur vrei să ștergi "{deleteTarget?.label}"? Acțiunea este ireversibilă.
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
