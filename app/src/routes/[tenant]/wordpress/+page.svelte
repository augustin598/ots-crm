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
		lastError: string | null;
		clientId: string | null;
		clientName: string | null;
		createdAt: string;
	};

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
		<Button onclick={() => (addOpen = true)}>
			<PlusIcon class="mr-2 size-4" />
			Adaugă site
		</Button>
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
