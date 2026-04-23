<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import KeyIcon from '@lucide/svelte/icons/key';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
	import DatabaseBackupIcon from '@lucide/svelte/icons/database-backup';

	type UpdateCounts = {
		core: number;
		plugins: number;
		themes: number;
		security: number;
		total: number;
	};

	type WpSite = {
		id: string;
		name: string;
		siteUrl: string;
		status: 'connected' | 'disconnected' | 'error' | 'pending';
		uptimeStatus: 'up' | 'down' | 'unknown';
		wpVersion: string | null;
		phpVersion: string | null;
		lastHealthCheckAt: string | null;
		lastUptimePingAt: string | null;
		lastUpdatesCheckAt: string | null;
		lastError: string | null;
		clientId: string | null;
		clientName: string | null;
		createdAt: string;
		updates: UpdateCounts;
	};

	type PendingUpdate = {
		id: string;
		type: 'core' | 'plugin' | 'theme';
		slug: string;
		name: string;
		currentVersion: string;
		newVersion: string;
		securityUpdate: number;
		autoUpdate: number;
	};

	type BackupRow = {
		id: string;
		trigger: string;
		status: string;
		archiveUrl: string | null;
		sizeBytes: number | null;
		error: string | null;
		startedAt: string | null;
		finishedAt: string | null;
		createdAt: string;
	};

	type ApplyResultItem = { type: string; slug: string; success: boolean; message: string };

	const tenantSlug = $derived(page.params.tenant);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress/sites`);

	let sites = $state<WpSite[]>([]);
	let loading = $state(true);
	const refreshingIds = new SvelteSet<string>();

	let addOpen = $state(false);
	let addForm = $state({ name: '', siteUrl: '', secretKey: '' });
	let adding = $state(false);

	let generatedSecret = $state<string | null>(null);
	let generatedSecretOpen = $state(false);

	let rotateOpen = $state(false);
	let rotateForm = $state({ siteId: '', siteName: '', secret: '' });
	let rotating = $state(false);

	// Updates dialog state
	let updatesOpen = $state(false);
	let updatesSite = $state<WpSite | null>(null);
	let updatesList = $state<PendingUpdate[]>([]);
	let updatesLoading = $state(false);
	let updatesApplying = $state(false);
	const selectedUpdateIds = new SvelteSet<string>();
	let applyResults = $state<ApplyResultItem[] | null>(null);
	let backupFirst = $state(true);

	// Backups dialog state
	let backupsOpen = $state(false);
	let backupsSite = $state<WpSite | null>(null);
	let backupsList = $state<BackupRow[]>([]);
	let backupsLoading = $state(false);
	let triggeringBackup = $state(false);

	const totalSecurityUpdates = $derived(
		sites.reduce((sum, s) => sum + (s.updates?.security ?? 0), 0)
	);

	async function loadSites() {
		loading = true;
		try {
			const res = await fetch(apiBase);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { sites: WpSite[] };
			sites = data.sites;
		} catch (err) {
			toast.error('Nu s-au putut încărca site-urile WordPress');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(loadSites);

	async function addSite() {
		if (!addForm.name.trim() || !addForm.siteUrl.trim()) {
			toast.error('Completează numele și URL-ul');
			return;
		}
		adding = true;
		try {
			const res = await fetch(apiBase, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: addForm.name.trim(),
					siteUrl: addForm.siteUrl.trim(),
					secretKey: addForm.secretKey.trim() || undefined
				})
			});
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
				secret?: string;
			};
			if (!res.ok) {
				toast.error(body.error || 'Eroare la adăugare');
				return;
			}
			toast.success('Site adăugat');
			addOpen = false;
			if (body.secret) {
				generatedSecret = body.secret;
				generatedSecretOpen = true;
			}
			addForm = { name: '', siteUrl: '', secretKey: '' };
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			adding = false;
		}
	}

	async function refreshSite(id: string) {
		refreshingIds.add(id);
		try {
			const res = await fetch(`${apiBase}/${id}/refresh`, { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				toast.error(body.error || 'Eroare la refresh');
			} else if (body.error) {
				toast.error(`Refresh cu eroare: ${body.error}`);
			} else {
				toast.success('Actualizat');
			}
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			refreshingIds.delete(id);
		}
	}

	function openRotate(site: WpSite) {
		rotateForm = { siteId: site.id, siteName: site.name, secret: '' };
		rotateOpen = true;
	}

	async function openUpdates(site: WpSite) {
		updatesSite = site;
		updatesOpen = true;
		updatesList = [];
		applyResults = null;
		selectedUpdateIds.clear();
		updatesLoading = true;
		try {
			const res = await fetch(`${apiBase}/${site.id}/updates`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { updates: PendingUpdate[] };
			updatesList = data.updates;
			// Pre-select security updates to nudge the user toward safe defaults.
			for (const u of data.updates) {
				if (u.securityUpdate) selectedUpdateIds.add(u.id);
			}
		} catch (err) {
			toast.error('Nu s-au putut încărca update-urile');
			console.error(err);
		} finally {
			updatesLoading = false;
		}
	}

	async function refreshUpdates() {
		if (!updatesSite) return;
		updatesLoading = true;
		applyResults = null;
		try {
			const res = await fetch(`${apiBase}/${updatesSite.id}/updates`, { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
			if (!res.ok || !body.ok) {
				toast.error(body.error || 'Refresh eșuat');
			} else {
				toast.success('Update-uri actualizate');
			}
			// Reload list after refresh
			const listRes = await fetch(`${apiBase}/${updatesSite.id}/updates`);
			const listBody = (await listRes.json()) as { updates: PendingUpdate[] };
			updatesList = listBody.updates;
			selectedUpdateIds.clear();
			for (const u of listBody.updates) {
				if (u.securityUpdate) selectedUpdateIds.add(u.id);
			}
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			updatesLoading = false;
		}
	}

	function toggleUpdateSelection(id: string) {
		if (selectedUpdateIds.has(id)) selectedUpdateIds.delete(id);
		else selectedUpdateIds.add(id);
	}

	function selectAllUpdates(filter?: 'security' | 'all' | 'none') {
		if (filter === 'none') {
			selectedUpdateIds.clear();
			return;
		}
		for (const u of updatesList) {
			if (filter === 'security') {
				if (u.securityUpdate) selectedUpdateIds.add(u.id);
				else selectedUpdateIds.delete(u.id);
			} else {
				selectedUpdateIds.add(u.id);
			}
		}
	}

	async function applySelectedUpdates() {
		if (!updatesSite || selectedUpdateIds.size === 0) return;
		const items = updatesList
			.filter((u) => selectedUpdateIds.has(u.id))
			.map((u) => ({ type: u.type, slug: u.slug }));
		if (items.length === 0) return;

		updatesApplying = true;
		applyResults = null;
		try {
			if (backupFirst) {
				toast.info('Rulez backup înainte de update-uri…');
				const bres = await fetch(`${apiBase}/${updatesSite.id}/backup`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ trigger: 'pre_update' })
				});
				const bbody = (await bres.json().catch(() => ({}))) as { status?: string; error?: string };
				if (!bres.ok || bbody.status !== 'success') {
					toast.error(`Backup eșuat: ${bbody.error ?? 'necunoscut'}. Update-urile nu au rulat.`);
					return;
				}
				toast.success('Backup OK. Rulez update-uri…');
			}

			const res = await fetch(`${apiBase}/${updatesSite.id}/apply-updates`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});
			const body = (await res.json().catch(() => ({}))) as {
				status?: string;
				error?: string;
				items?: ApplyResultItem[];
			};
			if (!res.ok) {
				toast.error(body.error || 'Update-urile au eșuat');
				applyResults = body.items ?? null;
				return;
			}
			applyResults = body.items ?? [];
			if (body.status === 'success') toast.success('Toate update-urile au reușit');
			else if (body.status === 'partial') toast.warning('Unele update-uri au eșuat');
			else toast.error('Update-urile au eșuat');
			// Refresh the counts on the main list.
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			updatesApplying = false;
		}
	}

	async function openBackups(site: WpSite) {
		backupsSite = site;
		backupsOpen = true;
		backupsList = [];
		backupsLoading = true;
		try {
			const res = await fetch(`${apiBase}/${site.id}/backups`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { backups: BackupRow[] };
			backupsList = data.backups;
		} catch (err) {
			toast.error('Nu s-au putut încărca backup-urile');
			console.error(err);
		} finally {
			backupsLoading = false;
		}
	}

	async function runBackup() {
		if (!backupsSite) return;
		triggeringBackup = true;
		try {
			const res = await fetch(`${apiBase}/${backupsSite.id}/backup`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trigger: 'manual' })
			});
			const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
			if (!res.ok || body.status !== 'success') {
				toast.error(body.error || 'Backup eșuat');
			} else {
				toast.success('Backup creat');
			}
			// Reload list
			const listRes = await fetch(`${apiBase}/${backupsSite.id}/backups`);
			const listBody = (await listRes.json()) as { backups: BackupRow[] };
			backupsList = listBody.backups;
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			triggeringBackup = false;
		}
	}

	function formatBytes(bytes: number | null): string {
		if (!bytes) return '—';
		const mb = bytes / 1024 / 1024;
		if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
		if (mb < 1024) return `${mb.toFixed(1)} MB`;
		return `${(mb / 1024).toFixed(2)} GB`;
	}

	async function saveRotatedSecret() {
		const secret = rotateForm.secret.trim();
		if (secret.length !== 64 || !/^[0-9a-f]+$/i.test(secret)) {
			toast.error('Secretul trebuie să aibă exact 64 caractere hex');
			return;
		}
		rotating = true;
		try {
			const res = await fetch(`${apiBase}/${rotateForm.siteId}/secret`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ secret })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean };
			if (!res.ok) {
				toast.error(body.error || 'Eroare la salvare');
				return;
			}
			if (body.success) {
				toast.success('Secret actualizat. Site conectat.');
			} else {
				toast.error(`Secret salvat, dar health check a eșuat: ${body.error ?? 'necunoscut'}`);
			}
			rotateOpen = false;
			rotateForm = { siteId: '', siteName: '', secret: '' };
			await loadSites();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			rotating = false;
		}
	}

	function copySecret() {
		if (!generatedSecret) return;
		navigator.clipboard
			.writeText(generatedSecret)
			.then(() => toast.success('Copiat în clipboard'))
			.catch(() => toast.error('Nu s-a putut copia'));
	}

	function formatDate(iso: string | null): string {
		if (!iso) return 'Niciodată';
		try {
			const d = new Date(iso);
			return d.toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
		} catch {
			return iso;
		}
	}

	function statusBadgeVariant(
		status: WpSite['status']
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'connected') return 'default';
		if (status === 'error') return 'destructive';
		return 'secondary';
	}

	function statusLabel(status: WpSite['status']): string {
		return (
			{
				connected: 'Conectat',
				disconnected: 'Deconectat',
				error: 'Eroare',
				pending: 'În așteptare'
			} as const
		)[status];
	}
</script>

<svelte:head>
	<title>WordPress — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 p-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Site-uri WordPress</h1>
			<p class="text-sm text-muted-foreground">
				Control centralizat pentru site-urile WordPress ale clienților.
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if totalSecurityUpdates > 0}
				<Badge variant="destructive" class="flex items-center gap-1 text-sm">
					<ShieldAlertIcon class="size-4" />
					{totalSecurityUpdates} update-uri de securitate în total
				</Badge>
			{/if}
			<Button onclick={() => (addOpen = true)}>
				<PlusIcon class="mr-2 size-4" />
				Adaugă site
			</Button>
		</div>
	</div>

	{#if loading}
		<div class="text-sm text-muted-foreground">Se încarcă…</div>
	{:else if sites.length === 0}
		<Card class="flex flex-col items-center justify-center gap-3 p-12 text-center">
			<GlobeIcon class="size-12 text-muted-foreground" />
			<div>
				<h3 class="text-lg font-medium">Niciun site WordPress adăugat</h3>
				<p class="text-sm text-muted-foreground">
					Instalează plugin-ul <strong>OTS Connector</strong> pe site-ul WordPress al clientului,
					apoi adaugă-l aici folosind secretul generat de plugin.
				</p>
			</div>
			<Button onclick={() => (addOpen = true)}>
				<PlusIcon class="mr-2 size-4" />
				Adaugă primul site
			</Button>
		</Card>
	{:else}
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#each sites as site (site.id)}
				<Card class="flex flex-col gap-3 p-5">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<h3 class="truncate font-medium">{site.name}</h3>
								{#if site.uptimeStatus === 'up'}
									<CircleCheckIcon class="size-4 shrink-0 text-green-600" aria-label="Up" />
								{:else if site.uptimeStatus === 'down'}
									<CircleXIcon class="size-4 shrink-0 text-red-600" aria-label="Down" />
								{:else}
									<CircleIcon class="size-4 shrink-0 text-muted-foreground" aria-label="Unknown" />
								{/if}
							</div>
							<a
								href={site.siteUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="truncate text-xs text-muted-foreground hover:underline"
							>
								{site.siteUrl}
							</a>
							{#if site.clientName}
								<p class="mt-1 truncate text-xs text-muted-foreground">
									Client: <span class="font-medium">{site.clientName}</span>
								</p>
							{/if}
						</div>
						<Badge variant={statusBadgeVariant(site.status)}>{statusLabel(site.status)}</Badge>
					</div>

					<div class="grid grid-cols-2 gap-2 text-xs">
						<div>
							<div class="text-muted-foreground">WordPress</div>
							<div class="font-medium">{site.wpVersion ?? '—'}</div>
						</div>
						<div>
							<div class="text-muted-foreground">PHP</div>
							<div class="font-medium">{site.phpVersion ?? '—'}</div>
						</div>
						<div class="col-span-2">
							<div class="text-muted-foreground">Ultima verificare</div>
							<div class="font-medium">{formatDate(site.lastHealthCheckAt)}</div>
						</div>
					</div>

					{#if site.updates && site.updates.total > 0}
						<button
							type="button"
							class="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-2 text-left text-xs transition-colors hover:bg-muted"
							onclick={() => openUpdates(site)}
						>
							<div class="flex items-center gap-2">
								<ArrowUpCircleIcon class="size-4 text-primary" />
								<span class="font-medium">
									{site.updates.total}
									{site.updates.total === 1 ? 'update' : 'update-uri'}
								</span>
								<span class="text-muted-foreground">
									({site.updates.core}c · {site.updates.plugins}p · {site.updates.themes}t)
								</span>
							</div>
							{#if site.updates.security > 0}
								<Badge variant="destructive" class="flex items-center gap-1">
									<ShieldAlertIcon class="size-3" />
									{site.updates.security} securitate
								</Badge>
							{/if}
						</button>
					{:else if site.status === 'connected' && site.lastUpdatesCheckAt}
						<div class="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
							<span class="flex items-center gap-2">
								<ArrowUpCircleIcon class="size-4" />
								Totul e la zi
							</span>
						</div>
					{/if}

					{#if site.lastError && site.status === 'error'}
						<div class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
							<CircleAlertIcon class="size-4 shrink-0" />
							<span class="break-words">{site.lastError}</span>
						</div>
					{/if}

					<div class="flex gap-2 pt-1">
						<Button
							variant="outline"
							size="sm"
							class="flex-1"
							disabled={refreshingIds.has(site.id)}
							onclick={() => refreshSite(site.id)}
						>
							<RefreshCwIcon
								class="mr-2 size-4 {refreshingIds.has(site.id) ? 'animate-spin' : ''}"
							/>
							Refresh
						</Button>
						<Button variant="outline" size="sm" onclick={() => openBackups(site)} title="Backup-uri">
							<DatabaseBackupIcon class="size-4" />
						</Button>
						<Button variant="outline" size="sm" onclick={() => openRotate(site)} title="Schimbă secret HMAC">
							<KeyIcon class="size-4" />
						</Button>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<!-- Add site dialog -->
<Dialog bind:open={addOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Adaugă site WordPress</DialogTitle>
			<DialogDescription>
				Instalează plugin-ul OTS Connector pe site-ul clientului și copiază secretul generat mai jos.
				Dacă lași secretul gol, CRM-ul generează unul pe care îl copiezi în plugin după.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-3">
			<div class="flex flex-col gap-1">
				<Label for="wp-name">Nume (label)</Label>
				<Input
					id="wp-name"
					bind:value={addForm.name}
					placeholder="Acme — Blog"
					autocomplete="off"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<Label for="wp-url">URL site</Label>
				<Input
					id="wp-url"
					bind:value={addForm.siteUrl}
					placeholder="https://exemplu.ro"
					autocomplete="off"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<Label for="wp-secret">Secret HMAC (opțional)</Label>
				<Input
					id="wp-secret"
					bind:value={addForm.secretKey}
					placeholder="Lasă gol pentru generare automată"
					autocomplete="off"
				/>
				<p class="text-xs text-muted-foreground">
					64 de caractere hex. Dacă îl lași gol, îl generăm și ți-l afișăm o singură dată.
				</p>
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (addOpen = false)} disabled={adding}>Anulează</Button>
			<Button onclick={addSite} disabled={adding}>
				{adding ? 'Se adaugă…' : 'Adaugă'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Generated secret display -->
<Dialog bind:open={updatesOpen}>
	<DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Update-uri — {updatesSite?.name ?? ''}</DialogTitle>
			<DialogDescription>
				Selectează update-urile de aplicat. Rularea unui backup înainte e recomandată pentru major/theme changes.
			</DialogDescription>
		</DialogHeader>

		{#if applyResults}
			<div class="flex flex-col gap-2">
				<h3 class="text-sm font-semibold">Rezultat</h3>
				{#each applyResults as r (r.slug + r.type)}
					<div class="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
						{#if r.success}
							<CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
						{:else}
							<CircleXIcon class="mt-0.5 size-4 shrink-0 text-red-600" />
						{/if}
						<div class="min-w-0 flex-1">
							<div class="font-medium">{r.type} · {r.slug}</div>
							<div class="truncate text-muted-foreground">{r.message}</div>
						</div>
					</div>
				{/each}
			</div>
			<DialogFooter>
				<Button variant="outline" onclick={() => (applyResults = null)}>Înapoi la listă</Button>
				<Button onclick={() => (updatesOpen = false)}>Închide</Button>
			</DialogFooter>
		{:else if updatesLoading}
			<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
		{:else if updatesList.length === 0}
			<div class="flex flex-col items-center gap-3 py-8 text-center">
				<CircleCheckIcon class="size-10 text-green-600" />
				<p class="text-sm font-medium">Totul e la zi!</p>
				<Button variant="outline" size="sm" onclick={refreshUpdates}>
					<RefreshCwIcon class="mr-2 size-4" />
					Verifică din nou
				</Button>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => selectAllUpdates('security')}>
					<ShieldAlertIcon class="mr-2 size-4" />
					Doar securitate
				</Button>
				<Button variant="outline" size="sm" onclick={() => selectAllUpdates('all')}>
					Toate
				</Button>
				<Button variant="outline" size="sm" onclick={() => selectAllUpdates('none')}>
					Niciunul
				</Button>
				<div class="ml-auto">
					<Button variant="ghost" size="sm" onclick={refreshUpdates} disabled={updatesLoading}>
						<RefreshCwIcon class="mr-2 size-4 {updatesLoading ? 'animate-spin' : ''}" />
						Refresh
					</Button>
				</div>
			</div>

			<div class="flex flex-col divide-y divide-border rounded-md border border-border">
				{#each updatesList as u (u.id)}
					<label class="flex cursor-pointer items-start gap-3 p-3 text-sm transition-colors hover:bg-muted/40">
						<input
							type="checkbox"
							class="mt-0.5 size-4"
							checked={selectedUpdateIds.has(u.id)}
							onchange={() => toggleUpdateSelection(u.id)}
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-medium">{u.name}</span>
								<Badge variant="outline" class="text-[10px] uppercase">{u.type}</Badge>
								{#if u.securityUpdate}
									<Badge variant="destructive" class="flex items-center gap-1 text-[10px]">
										<ShieldAlertIcon class="size-3" />
										Securitate
									</Badge>
								{/if}
							</div>
							<div class="text-xs text-muted-foreground">
								<code>{u.currentVersion || '—'}</code>
								→
								<code class="font-semibold">{u.newVersion}</code>
							</div>
						</div>
					</label>
				{/each}
			</div>

			<div class="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs">
				<input
					id="wp-backup-first"
					type="checkbox"
					class="mt-0.5 size-4"
					bind:checked={backupFirst}
				/>
				<label for="wp-backup-first" class="cursor-pointer">
					<strong>Rulează backup înainte</strong> (recomandat). Dacă backup-ul eșuează, update-urile nu rulează.
				</label>
			</div>

			<DialogFooter>
				<Button variant="outline" onclick={() => (updatesOpen = false)} disabled={updatesApplying}>
					Anulează
				</Button>
				<Button
					onclick={applySelectedUpdates}
					disabled={updatesApplying || selectedUpdateIds.size === 0}
				>
					{#if updatesApplying}
						<RefreshCwIcon class="mr-2 size-4 animate-spin" />
						Se aplică…
					{:else}
						<ArrowUpCircleIcon class="mr-2 size-4" />
						Aplică {selectedUpdateIds.size} update-uri
					{/if}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>

<Dialog bind:open={backupsOpen}>
	<DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Backup-uri — {backupsSite?.name ?? ''}</DialogTitle>
			<DialogDescription>
				Istoric backup-uri pentru acest site. Fiecare backup conține un ZIP cu wp-content + dump SQL complet.
			</DialogDescription>
		</DialogHeader>

		<div class="flex justify-end">
			<Button onclick={runBackup} disabled={triggeringBackup}>
				{#if triggeringBackup}
					<RefreshCwIcon class="mr-2 size-4 animate-spin" />
					Se creează…
				{:else}
					<DatabaseBackupIcon class="mr-2 size-4" />
					Backup nou
				{/if}
			</Button>
		</div>

		{#if backupsLoading}
			<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
		{:else if backupsList.length === 0}
			<div class="py-8 text-center text-sm text-muted-foreground">Niciun backup făcut încă.</div>
		{:else}
			<div class="flex flex-col divide-y divide-border rounded-md border border-border">
				{#each backupsList as b (b.id)}
					<div class="flex items-start gap-3 p-3 text-sm">
						<div class="mt-0.5 shrink-0">
							{#if b.status === 'success'}
								<CircleCheckIcon class="size-4 text-green-600" />
							{:else if b.status === 'failed'}
								<CircleXIcon class="size-4 text-red-600" />
							{:else}
								<RefreshCwIcon class="size-4 animate-spin text-muted-foreground" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 text-xs">
								<span class="font-medium">{formatDate(b.createdAt)}</span>
								<Badge variant="outline" class="text-[10px] uppercase">{b.trigger}</Badge>
								<span class="text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
							</div>
							{#if b.error}
								<div class="mt-1 text-xs text-destructive break-words">{b.error}</div>
							{/if}
						</div>
						{#if b.archiveUrl}
							<a
								href={b.archiveUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="shrink-0"
							>
								<Button variant="outline" size="sm">
									<DownloadIcon class="mr-2 size-4" />
									Descarcă
								</Button>
							</a>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={() => (backupsOpen = false)}>Închide</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={rotateOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Schimbă secret HMAC</DialogTitle>
			<DialogDescription>
				Lipește aici secretul afișat de plugin-ul OTS Connector pe <strong>{rotateForm.siteName}</strong>.
				CRM-ul îl va salva encriptat și va rula imediat un health check.
			</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-1">
			<Label for="wp-rotate-secret">Secret nou (64 caractere hex)</Label>
			<Input
				id="wp-rotate-secret"
				bind:value={rotateForm.secret}
				placeholder="f7d2ed84c9e1765c0d90ad2fb1a4d557a24c4452c5a6e3d4ebf1448a8b1f992e"
				autocomplete="off"
			/>
			<p class="text-xs text-muted-foreground">
				Deschide în WordPress: <strong>Settings → OTS Connector</strong> și copiază secretul de acolo.
			</p>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (rotateOpen = false)} disabled={rotating}>Anulează</Button>
			<Button onclick={saveRotatedSecret} disabled={rotating}>
				{rotating ? 'Se salvează…' : 'Salvează și verifică'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={generatedSecretOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Secret generat</DialogTitle>
			<DialogDescription>
				Copiază acest secret în plugin-ul OTS Connector pe site-ul WordPress. <strong>
					Nu va mai fi afișat după ce închizi această fereastră.
				</strong>
			</DialogDescription>
		</DialogHeader>

		{#if generatedSecret}
			<div class="flex items-center gap-2 rounded-md bg-muted p-3 font-mono text-xs break-all">
				{generatedSecret}
			</div>
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={copySecret}>
				<CopyIcon class="mr-2 size-4" />
				Copiază
			</Button>
			<Button onclick={() => ((generatedSecretOpen = false), (generatedSecret = null))}>
				Am copiat, închide
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
