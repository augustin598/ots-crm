<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Plus,
		Globe,
		Star,
		StarOff,
		Pencil,
		Trash2,
		ExternalLink,
		Link2,
		CheckCircle2,
		TrendingUp,
		AlertCircle,
		Loader2
	} from '@lucide/svelte';
	import {
		getClientWebsitesSeoStats,
		createClientWebsite,
		updateClientWebsite,
		deleteClientWebsite,
		setDefaultClientWebsite
	} from '$lib/remotes/client-websites.remote';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	const statsQuery = $derived(getClientWebsitesSeoStats(clientId));
	const stats = $derived(statsQuery.current || []);
	const loading = $derived(statsQuery.loading);

	// --- Adăugare website ---
	let isAdding = $state(false);
	let addName = $state('');
	let addUrl = $state('');
	let addError = $state('');
	let addLoading = $state(false);

	async function handleAdd() {
		if (!addUrl.trim()) {
			addError = 'URL-ul este obligatoriu';
			return;
		}
		addError = '';
		addLoading = true;
		try {
			await createClientWebsite({ clientId, name: addName.trim() || undefined, url: addUrl.trim() }).updates(statsQuery);
			addName = '';
			addUrl = '';
			isAdding = false;
		} catch (e) {
			addError = e instanceof Error ? e.message : 'Eroare la adăugare';
		} finally {
			addLoading = false;
		}
	}

	// --- Editare website ---
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editUrl = $state('');
	let editError = $state('');
	let editLoading = $state(false);

	function startEdit(id: string, name: string | null, url: string) {
		editingId = id;
		editName = name || '';
		editUrl = url;
		editError = '';
	}

	function cancelEdit() {
		editingId = null;
		editError = '';
	}

	async function handleUpdate() {
		if (!editingId) return;
		if (!editUrl.trim()) {
			editError = 'URL-ul este obligatoriu';
			return;
		}
		editError = '';
		editLoading = true;
		try {
			await updateClientWebsite({
				websiteId: editingId,
				name: editName.trim() || null,
				url: editUrl.trim()
			}).updates(statsQuery);
			editingId = null;
		} catch (e) {
			editError = e instanceof Error ? e.message : 'Eroare la actualizare';
		} finally {
			editLoading = false;
		}
	}

	// --- Ștergere ---
	let deletingId = $state<string | null>(null);
	let deleteError = $state('');
	let deleteLoading = $state(false);

	async function handleDelete(websiteId: string) {
		deleteError = '';
		deleteLoading = true;
		try {
			await deleteClientWebsite(websiteId).updates(statsQuery);
			deletingId = null;
		} catch (e) {
			deleteError = e instanceof Error ? e.message : 'Eroare la ștergere';
			deletingId = null;
		} finally {
			deleteLoading = false;
		}
	}

	// --- Setare default ---
	let settingDefaultId = $state<string | null>(null);

	async function handleSetDefault(websiteId: string) {
		settingDefaultId = websiteId;
		try {
			await setDefaultClientWebsite(websiteId).updates(statsQuery);
		} catch (e) {
			// ignore
		} finally {
			settingDefaultId = null;
		}
	}

	function formatPrice(cents: number): string {
		return (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' RON';
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-xl font-semibold">Website-uri administrate</h2>
			<p class="text-sm text-muted-foreground mt-0.5">
				Gestionează website-urile clientului și urmărește performanța SEO per site
			</p>
		</div>
		{#if !isAdding}
			<Button onclick={() => { isAdding = true; addName = ''; addUrl = ''; addError = ''; }}>
				<Plus class="mr-2 h-4 w-4" />
				Adaugă website
			</Button>
		{/if}
	</div>

	<!-- Eroare ștergere globală -->
	{#if deleteError}
		<div class="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
			{deleteError}
		</div>
	{/if}

	<!-- Form adăugare -->
	{#if isAdding}
		<Card>
			<CardHeader>
				<CardTitle class="text-base">Website nou</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<Label>Nume (opțional)</Label>
						<Input bind:value={addName} placeholder="ex: Site principal, Shop, Blog" />
					</div>
					<div class="space-y-1.5">
						<Label>URL *</Label>
						<Input bind:value={addUrl} placeholder="https://brand-a.ro" />
					</div>
				</div>
				{#if addError}
					<p class="text-sm text-destructive">{addError}</p>
				{/if}
				<div class="flex gap-2 justify-end">
					<Button variant="outline" onclick={() => { isAdding = false; addError = ''; }}>Anulează</Button>
					<Button onclick={handleAdd} disabled={addLoading}>
						{#if addLoading}<Loader2 class="mr-2 h-4 w-4 animate-spin" />{/if}
						Adaugă
					</Button>
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="flex items-center justify-center py-12 text-muted-foreground">
			<Loader2 class="mr-2 h-5 w-5 animate-spin" />
			Se încarcă...
		</div>
	{:else if stats.length === 0}
		<!-- Empty state -->
		<Card>
			<CardContent class="flex flex-col items-center justify-center py-16 text-center">
				<Globe class="h-12 w-12 text-muted-foreground/40 mb-4" />
				<h3 class="text-base font-medium mb-1">Niciun website înregistrat</h3>
				<p class="text-sm text-muted-foreground mb-6">
					Adaugă website-urile acestui client pentru a urmări backlink-urile per site.
				</p>
				<Button onclick={() => { isAdding = true; }}>
					<Plus class="mr-2 h-4 w-4" />
					Adaugă primul website
				</Button>
			</CardContent>
		</Card>
	{:else}
		<!-- Grid de carduri website -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each stats as { website, totalLinks, publishedLinks, dofollowLinks, okLinks, totalPriceRON }}
				<Card class="relative {website.isDefault ? 'ring-2 ring-primary/30' : ''}">
					<CardHeader class="pb-3">
						{#if editingId === website.id}
							<!-- Edit form inline -->
							<div class="space-y-3">
								<div class="space-y-1.5">
									<Label class="text-xs">Nume</Label>
									<Input bind:value={editName} placeholder="ex: Site principal" class="h-8 text-sm" />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs">URL *</Label>
									<Input bind:value={editUrl} placeholder="https://..." class="h-8 text-sm" />
								</div>
								{#if editError}
									<p class="text-xs text-destructive">{editError}</p>
								{/if}
								<div class="flex gap-2 justify-end">
									<Button variant="ghost" size="sm" onclick={cancelEdit}>Anulează</Button>
									<Button size="sm" onclick={handleUpdate} disabled={editLoading}>
										{#if editLoading}<Loader2 class="mr-2 h-3 w-3 animate-spin" />{/if}
										Salvează
									</Button>
								</div>
							</div>
						{:else}
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<CardTitle class="text-sm font-semibold truncate">
											{website.name || website.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
										</CardTitle>
										{#if website.isDefault}
											<Badge variant="secondary" class="text-xs shrink-0">Principal</Badge>
										{/if}
									</div>
									<a
										href={website.url}
										target="_blank"
										rel="noopener noreferrer"
										class="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5 truncate"
									>
										{website.url.replace(/^https?:\/\//, '')}
										<ExternalLink class="h-2.5 w-2.5 shrink-0" />
									</a>
								</div>
								<div class="flex items-center gap-1 shrink-0">
									<!-- Setare default -->
									{#if !website.isDefault}
										<button
											onclick={() => handleSetDefault(website.id)}
											title="Setează ca principal"
											class="rounded p-1 text-muted-foreground hover:text-amber-500 hover:bg-amber-50 transition-colors"
											disabled={settingDefaultId === website.id}
										>
											{#if settingDefaultId === website.id}
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{:else}
												<StarOff class="h-3.5 w-3.5" />
											{/if}
										</button>
									{:else}
										<span class="rounded p-1 text-amber-500" title="Website principal">
											<Star class="h-3.5 w-3.5 fill-current" />
										</span>
									{/if}
									<!-- Edit -->
									<button
										onclick={() => startEdit(website.id, website.name, website.url)}
										title="Editează"
										class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
									>
										<Pencil class="h-3.5 w-3.5" />
									</button>
									<!-- Delete -->
									{#if deletingId === website.id}
										<div class="flex items-center gap-1">
											<span class="text-xs text-destructive">Sigur?</span>
											<button
												onclick={() => handleDelete(website.id)}
												class="text-xs text-destructive hover:underline"
												disabled={deleteLoading}
											>Da</button>
											<button
												onclick={() => { deletingId = null; deleteError = ''; }}
												class="text-xs text-muted-foreground hover:underline"
											>Nu</button>
										</div>
									{:else}
										<button
											onclick={() => { deletingId = website.id; deleteError = ''; }}
											title="Șterge"
											class="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
											disabled={totalLinks > 0}
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									{/if}
								</div>
							</div>
						{/if}
					</CardHeader>

					{#if editingId !== website.id}
						<CardContent class="pt-0">
							<!-- Stats grid -->
							<div class="grid grid-cols-2 gap-3 mb-4">
								<div class="rounded-lg bg-muted/50 px-3 py-2">
									<div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
										<Link2 class="h-3 w-3" />
										Total linkuri
									</div>
									<div class="text-lg font-bold">{totalLinks}</div>
								</div>
								<div class="rounded-lg bg-muted/50 px-3 py-2">
									<div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
										<CheckCircle2 class="h-3 w-3" />
										Publicate
									</div>
									<div class="text-lg font-bold text-green-600">{publishedLinks}</div>
								</div>
								<div class="rounded-lg bg-muted/50 px-3 py-2">
									<div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
										<TrendingUp class="h-3 w-3" />
										Dofollow
									</div>
									<div class="text-lg font-bold text-blue-600">{dofollowLinks}</div>
								</div>
								<div class="rounded-lg bg-muted/50 px-3 py-2">
									<div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
										<AlertCircle class="h-3 w-3" />
										Accesibile
									</div>
									<div class="text-lg font-bold">{okLinks}</div>
								</div>
							</div>

							{#if totalPriceRON > 0}
								<div class="text-xs text-muted-foreground mb-3">
									Total investit: <span class="font-medium text-foreground">{formatPrice(totalPriceRON)}</span>
								</div>
							{/if}

							<!-- CTA -->
							<Button
								variant="outline"
								size="sm"
								class="w-full text-xs"
								onclick={() => goto(`/${tenantSlug}/seo-links?clientId=${clientId}&websiteId=${website.id}`)}
							>
								<ExternalLink class="mr-1.5 h-3 w-3" />
								Vizualizează linkurile SEO
							</Button>
						</CardContent>
					{/if}
				</Card>
			{/each}
		</div>
	{/if}
</div>
