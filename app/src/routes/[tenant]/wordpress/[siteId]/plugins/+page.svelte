<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import PowerIcon from '@lucide/svelte/icons/power';
	import PowerOffIcon from '@lucide/svelte/icons/power-off';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';

	type WpPlugin = {
		plugin: string;
		name: string;
		version: string;
		description: string;
		author: string;
		authorUri: string;
		pluginUri: string;
		requiresWp: string;
		requiresPhp: string;
		network: boolean;
		active: boolean;
		autoUpdate: boolean;
		updateAvailable: boolean;
		newVersion: string | null;
	};

	const tenantSlug = $derived(page.params.tenant);
	const siteId = $derived(page.params.siteId);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress/sites/${siteId}/plugins`);

	let plugins = $state<WpPlugin[]>([]);
	let loading = $state(true);
	let statusFilter = $state<'all' | 'active' | 'inactive' | 'updates'>('all');
	let searchQuery = $state('');
	const busyPlugins = new SvelteSet<string>();

	const filtered = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		return plugins.filter((p) => {
			if (statusFilter === 'active' && !p.active) return false;
			if (statusFilter === 'inactive' && p.active) return false;
			if (statusFilter === 'updates' && !p.updateAvailable) return false;
			if (query) {
				const hay = `${p.name} ${p.description} ${p.author} ${p.plugin}`.toLowerCase();
				if (!hay.includes(query)) return false;
			}
			return true;
		});
	});

	const activeCount = $derived(plugins.filter((p) => p.active).length);
	const updatesCount = $derived(plugins.filter((p) => p.updateAvailable).length);

	async function loadPlugins() {
		loading = true;
		try {
			const res = await fetch(apiBase);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error || `HTTP ${res.status}`);
			}
			const data = (await res.json()) as { items: WpPlugin[] };
			plugins = data.items;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Nu s-au putut încărca plugin-urile');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(loadPlugins);

	async function runAction(p: WpPlugin, action: 'activate' | 'deactivate' | 'delete') {
		if (action === 'delete') {
			if (
				!confirm(
					`Ștergi plugin-ul „${p.name}" complet de pe site? Fișierele se elimină definitiv.`
				)
			)
				return;
		}
		busyPlugins.add(p.plugin);
		try {
			const res = await fetch(`${apiBase}/action`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, plugin: p.plugin })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				toast.error(body.error || `${action} eșuat`);
				return;
			}
			const label =
				action === 'activate' ? 'activat' : action === 'deactivate' ? 'dezactivat' : 'șters';
			toast.success(`${p.name} ${label}`);
			await loadPlugins();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			busyPlugins.delete(p.plugin);
		}
	}
</script>

<svelte:head>
	<title>Plugin-uri WordPress — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 p-6">
	<div class="flex items-center gap-2">
		<a href="/{tenantSlug}/wordpress">
			<Button variant="ghost" size="sm">
				<ArrowLeftIcon class="mr-2 size-4" />
				Înapoi la site-uri
			</Button>
		</a>
	</div>

	<div class="flex items-center justify-between gap-2">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Plugin-uri</h1>
			<p class="text-sm text-muted-foreground">
				{plugins.length} plugin-uri instalate · {activeCount} active
				{#if updatesCount > 0}
					· <span class="text-amber-600 font-medium">{updatesCount} update-uri disponibile</span>
				{/if}
			</p>
		</div>
		<Button variant="outline" onclick={loadPlugins} disabled={loading} title="Refresh">
			<RefreshCwIcon class="mr-2 size-4 {loading ? 'animate-spin' : ''}" />
			Refresh
		</Button>
	</div>

	<div class="flex items-center gap-2">
		<div class="relative flex-1 max-w-md">
			<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Caută după nume, autor sau descriere…"
				bind:value={searchQuery}
				class="pl-9"
			/>
		</div>
		<Select type="single" bind:value={statusFilter}>
			<SelectTrigger class="w-[200px]">
				{statusFilter === 'all'
					? 'Toate'
					: statusFilter === 'active'
						? 'Active'
						: statusFilter === 'inactive'
							? 'Inactive'
							: 'Cu update disponibil'}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">Toate</SelectItem>
				<SelectItem value="active">Active</SelectItem>
				<SelectItem value="inactive">Inactive</SelectItem>
				<SelectItem value="updates">Cu update disponibil</SelectItem>
			</SelectContent>
		</Select>
	</div>

	{#if loading && plugins.length === 0}
		<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
	{:else if filtered.length === 0}
		<Card class="flex flex-col items-center justify-center gap-3 p-12 text-center">
			<PlugIcon class="size-12 text-muted-foreground" />
			<div>
				<h3 class="text-lg font-medium">Niciun plugin găsit</h3>
				<p class="text-sm text-muted-foreground">
					{searchQuery || statusFilter !== 'all'
						? 'Schimbă filtrele sau caută altceva.'
						: 'Site-ul nu are plugin-uri instalate.'}
				</p>
			</div>
		</Card>
	{:else}
		<div class="space-y-3">
			{#each filtered as p (p.plugin)}
				<Card
					class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-md {p.active
						? 'hover:border-primary/20'
						: 'opacity-75 hover:opacity-100 hover:border-muted-foreground/20'}"
				>
					<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r {p.active
						? 'from-primary via-primary/80 to-primary/60'
						: 'from-muted-foreground/30 to-muted-foreground/10'}"></div>
					<div class="p-4 pt-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap mb-2">
									<div class="p-1.5 rounded-lg {p.active ? 'bg-primary/10' : 'bg-muted'}">
										<PlugIcon class="h-3.5 w-3.5 {p.active ? 'text-primary' : 'text-muted-foreground'}" />
									</div>
									<h3 class="text-lg font-bold tracking-tight text-foreground">
										{p.name}
									</h3>
									{#if p.active}
										<Badge variant="default" class="text-xs">Activ</Badge>
									{:else}
										<Badge variant="secondary" class="text-xs">Inactiv</Badge>
									{/if}
									{#if p.updateAvailable}
										<Badge
											variant="outline"
											class="flex items-center gap-1 text-xs border-amber-500 text-amber-600 dark:text-amber-400"
										>
											<ArrowUpCircleIcon class="size-3" />
											{p.version} → {p.newVersion}
										</Badge>
									{:else}
										<span class="text-xs text-muted-foreground">v{p.version}</span>
									{/if}
									{#if p.network}
										<Badge variant="outline" class="text-[10px]">Network</Badge>
									{/if}
									{#if p.autoUpdate}
										<Badge variant="outline" class="text-[10px]">Auto-update</Badge>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mb-2">
									<span>
										de
										{#if p.authorUri}
											<a href={p.authorUri} target="_blank" rel="noopener noreferrer" class="hover:underline">
												{p.author}
											</a>
										{:else}
											{p.author || 'autor necunoscut'}
										{/if}
									</span>
									{#if p.pluginUri}
										<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
										<a
											href={p.pluginUri}
											target="_blank"
											rel="noopener noreferrer"
											class="flex items-center gap-0.5 hover:underline"
										>
											Website <ExternalLinkIcon class="size-3" />
										</a>
									{/if}
									<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
									<code class="rounded bg-muted px-1 py-0.5 text-[10px]">{p.plugin}</code>
								</p>
								{#if p.description}
									<p class="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-1.5">
								{#if p.active}
									<Button
										variant="outline"
										size="sm"
										disabled={busyPlugins.has(p.plugin)}
										onclick={() => runAction(p, 'deactivate')}
										title="Dezactivează"
									>
										<PowerOffIcon class="mr-2 size-3.5" />
										Dezactivează
									</Button>
								{:else}
									<Button
										variant="outline"
										size="sm"
										disabled={busyPlugins.has(p.plugin)}
										onclick={() => runAction(p, 'activate')}
										title="Activează"
									>
										<PowerIcon class="mr-2 size-3.5" />
										Activează
									</Button>
								{/if}
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2"
									disabled={busyPlugins.has(p.plugin) || p.active}
									onclick={() => runAction(p, 'delete')}
									title={p.active ? 'Dezactivează înainte de a șterge' : 'Șterge definitiv'}
								>
									<Trash2Icon class="size-3.5 {p.active ? 'text-muted-foreground' : 'text-destructive'}" />
								</Button>
							</div>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
