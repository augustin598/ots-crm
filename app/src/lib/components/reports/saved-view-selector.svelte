<script lang="ts">
	import { browser } from '$app/environment';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import * as Dialog from '$lib/components/ui/dialog';
	import { getSavedViews, createSavedView, updateSavedView, deleteSavedView, type SavedViewFilters } from '$lib/remotes/saved-views.remote';
	import { toast } from 'svelte-sonner';
	import SaveIcon from '@lucide/svelte/icons/save';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';

	let {
		platform,
		tenantSlug,
		currentAccountId = '',
		currentFilters,
		onApplyView
	}: {
		platform: 'meta' | 'google' | 'tiktok';
		tenantSlug: string;
		currentAccountId?: string;
		currentFilters: SavedViewFilters;
		onApplyView: (filters: SavedViewFilters) => void;
	} = $props();

	// ---- State ----
	let activeViewId = $state<string | null>(null);
	let saveDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let newViewName = $state('');
	let setAsDefault = $state(false);
	let saving = $state(false);

	// ---- Fetch views ----
	const viewsQuery = getSavedViews({ platform });
	const viewsLoading = $derived(viewsQuery.loading ?? false);
	const allViews = $derived(viewsQuery.current || []);
	// Filter views by current account — show only views for this account + views without account
	const views = $derived(
		currentAccountId
			? allViews.filter((v: any) => !v.filters?.accountId || v.filters.accountId === currentAccountId)
			: allViews
	);
	const activeView = $derived(views.find((v: any) => v.id === activeViewId));

	// ---- Dirty detection ----
	const isDirty = $derived.by(() => {
		if (!activeView) return false;
		const saved = activeView.filters as SavedViewFilters;
		return saved.accountId !== currentFilters.accountId
			|| saved.columnPreset !== currentFilters.columnPreset
			|| saved.objectiveFilter !== currentFilters.objectiveFilter
			|| saved.statusFilter !== currentFilters.statusFilter
			|| saved.pageSize !== currentFilters.pageSize
			|| saved.datePreset !== currentFilters.datePreset
			|| (saved.datePreset === null && (saved.since !== currentFilters.since || saved.until !== currentFilters.until));
	});

	// ---- localStorage for last used view (per account) ----
	const STORAGE_KEY = $derived(`saved-view-last-${tenantSlug}-${platform}-${currentAccountId || 'all'}`);

	// Auto-load default or last-used view when account changes
	$effect(() => {
		if (!browser || views.length === 0) return;

		let targetId: string | null = null;

		// Priority 1: localStorage
		const lastUsedId = localStorage.getItem(STORAGE_KEY);
		if (lastUsedId && views.some((v: any) => v.id === lastUsedId)) {
			targetId = lastUsedId;
		} else {
			// Priority 2: default view
			const defaultView = views.find((v: any) => v.isDefault && (!v.filters?.accountId || v.filters.accountId === currentAccountId));
			if (defaultView) targetId = defaultView.id;
		}

		// Guard: only apply if changed (prevents infinite loop)
		if (targetId !== activeViewId) {
			if (targetId) {
				selectView(targetId);
			} else {
				activeViewId = null;
			}
		}
	});

	// ---- Actions ----
	function selectView(viewId: string | null) {
		activeViewId = viewId;
		if (viewId && browser) {
			localStorage.setItem(STORAGE_KEY, viewId);
		}
		const view = views.find((v: any) => v.id === viewId);
		if (view) {
			onApplyView(view.filters as SavedViewFilters);
		}
	}

	function handleDropdownChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		if (value === '') {
			activeViewId = null;
			if (browser) localStorage.removeItem(STORAGE_KEY);
		} else {
			selectView(value);
		}
	}

	function openSaveAs() {
		newViewName = '';
		setAsDefault = false;
		saveDialogOpen = true;
	}

	async function handleSave() {
		if (!activeViewId) return;
		saving = true;
		try {
			await updateSavedView({ id: activeViewId, filters: currentFilters });
			toast.success('Vizualizare actualizată');
		} catch (e) {
			toast.error('Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function handleSaveAs() {
		if (!newViewName.trim()) return;
		saving = true;
		try {
			const result = await createSavedView({
				name: newViewName.trim(),
				platform,
				filters: currentFilters,
				isDefault: setAsDefault
			});
			saveDialogOpen = false;
			activeViewId = result.id;
			if (browser) localStorage.setItem(STORAGE_KEY, result.id);
			toast.success(`Vizualizarea "${newViewName.trim()}" a fost salvată`);
		} catch (e) {
			toast.error('Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!activeViewId) return;
		saving = true;
		try {
			await deleteSavedView({ id: activeViewId });
			if (browser) localStorage.removeItem(STORAGE_KEY);
			activeViewId = null;
			deleteDialogOpen = false;
			toast.success('Vizualizare ștearsă');
		} catch (e) {
			toast.error('Nu poți șterge această vizualizare');
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex items-center gap-1.5">
	<!-- View dropdown -->
	<div class="flex items-center gap-1">
		<BookmarkIcon class="h-4 w-4 text-muted-foreground" />
		<select
			class="h-9 rounded-md border border-input bg-background px-3 text-sm max-w-[200px]"
			value={activeViewId ?? ''}
			onchange={handleDropdownChange}
			disabled={viewsLoading}
		>
			{#if viewsLoading}
				<option value="">Se încarcă...</option>
			{:else}
				<option value="">Vizualizare nesalvată</option>
				{#each views as view}
					<option value={view.id}>
						{view.isDefault ? '★ ' : ''}{view.name}{!view.isOwner ? ` (${view.userName})` : ''}
					</option>
				{/each}
			{/if}
		</select>
	</div>

	<!-- Save (overwrite) — only when active & dirty -->
	{#if activeViewId && isDirty && activeView?.isOwner}
		<Button variant="outline" size="sm" onclick={handleSave} disabled={saving} title="Salvează modificările">
			<SaveIcon class="h-3.5 w-3.5" />
		</Button>
	{/if}

	<!-- Save as -->
	<Button variant="outline" size="sm" onclick={openSaveAs} title="Salvează ca vizualizare nouă">
		<SaveIcon class="h-3.5 w-3.5 mr-1" /> Salvează
	</Button>

	<!-- Delete — only when active & owner -->
	{#if activeViewId && activeView?.isOwner}
		<Button variant="ghost" size="sm" onclick={() => { deleteDialogOpen = true; }} title="Șterge vizualizarea">
			<Trash2Icon class="h-3.5 w-3.5 text-destructive" />
		</Button>
	{/if}
</div>

<!-- Save As Dialog -->
<Dialog.Root bind:open={saveDialogOpen}>
	<Dialog.Content class="sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title>Salvează vizualizare</Dialog.Title>
			<Dialog.Description>Salvează configurația curentă de filtre pentru acces rapid.</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="view-name" class="text-sm font-medium">Nume vizualizare</label>
				<Input
					id="view-name"
					bind:value={newViewName}
					placeholder="Ex: Campanii active luna aceasta"
				/>
			</div>
			<label class="flex items-center gap-2 cursor-pointer">
				<Switch bind:checked={setAsDefault} />
				<span class="text-sm">Setează ca vizualizare implicită</span>
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => { saveDialogOpen = false; }}>Anulează</Button>
			<Button onclick={handleSaveAs} disabled={saving || !newViewName.trim()}>
				{saving ? 'Se salvează...' : 'Salvează'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Confirm Dialog -->
<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="sm:max-w-[350px]">
		<Dialog.Header>
			<Dialog.Title>Șterge vizualizare</Dialog.Title>
			<Dialog.Description>Ești sigur că vrei să ștergi "{activeView?.name}"? Acțiunea este ireversibilă.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => { deleteDialogOpen = false; }}>Anulează</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={saving}>
				{saving ? 'Se șterge...' : 'Șterge'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
