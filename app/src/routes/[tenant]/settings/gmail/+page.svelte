<script lang="ts">
	import { getGmailConnectionStatus, updateGmailSyncConfig } from '$lib/remotes/supplier-invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Switch } from '$lib/components/ui/switch';
	import { CheckCircle2, XCircle, Mail, Link as LinkIcon, Unlink, Settings, Save } from '@lucide/svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getGmailConnectionStatus();
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	let disconnecting = $state(false);
	let savingConfig = $state(false);
	let error = $state<string | null>(null);

	// Sync config state (initialized from status when loaded)
	let syncEnabled = $state(true);
	let syncInterval = $state('daily');
	let syncDateRangeDays = $state(7);
	let selectedSyncParsers = $state<string[] | null>(null); // null = all

	// Initialize sync config from status
	$effect(() => {
		if (status?.connected) {
			syncEnabled = status.syncEnabled ?? true;
			syncInterval = status.syncInterval ?? 'daily';
			syncDateRangeDays = status.syncDateRangeDays ?? 7;
			selectedSyncParsers = status.syncParserIds ?? null;
		}
	});

	const allParsers = [
		{ id: 'cpanel', label: 'cPanel/WHM' },
		{ id: 'whmcs', label: 'WHMCS' },
		{ id: 'hetzner', label: 'Hetzner' },
		{ id: 'google', label: 'Google' },
		{ id: 'ovh', label: 'OVH' },
		{ id: 'digitalocean', label: 'DigitalOcean' },
		{ id: 'aws', label: 'AWS' },
		{ id: 'generic', label: 'Altele (generic)' }
	];

	const useAllParsers = $derived(selectedSyncParsers === null);

	function toggleAllParsers() {
		if (selectedSyncParsers === null) {
			selectedSyncParsers = allParsers.map((p) => p.id);
		} else {
			selectedSyncParsers = null;
		}
	}

	function toggleSyncParser(id: string) {
		if (selectedSyncParsers === null) {
			// Switch from "all" to specific selection minus this one
			selectedSyncParsers = allParsers.map((p) => p.id).filter((pid) => pid !== id);
		} else if (selectedSyncParsers.includes(id)) {
			selectedSyncParsers = selectedSyncParsers.filter((p) => p !== id);
		} else {
			selectedSyncParsers = [...selectedSyncParsers, id];
		}
	}

	function isParserSelected(id: string): boolean {
		return selectedSyncParsers === null || selectedSyncParsers.includes(id);
	}

	// Check URL params for success/error from OAuth callback
	const urlSuccess = $derived(page.url.searchParams.get('success') === 'true');
	const urlError = $derived(page.url.searchParams.get('error'));

	async function handleConnect() {
		window.location.href = `/api/gmail/auth?tenant=${tenantSlug}`;
	}

	async function handleDisconnect() {
		if (!confirm('Ești sigur că vrei să deconectezi Gmail? Sincronizarea automată va fi oprită.')) {
			return;
		}

		disconnecting = true;
		error = null;

		try {
			const res = await fetch(`/api/gmail/disconnect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tenant: tenantSlug })
			});
			if (!res.ok) throw new Error('Failed to disconnect');
			window.location.reload();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Eroare la deconectare';
		} finally {
			disconnecting = false;
		}
	}

	async function handleSaveConfig() {
		savingConfig = true;
		try {
			await updateGmailSyncConfig({
				syncEnabled,
				syncInterval: syncInterval as 'daily' | 'twice_daily' | 'weekly',
				syncParserIds: selectedSyncParsers,
				syncDateRangeDays
			}).updates(statusQuery);
			toast.success('Configurare salvată');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			savingConfig = false;
		}
	}

	const intervalLabel = (val: string) => {
		switch (val) {
			case 'daily': return 'Zilnic';
			case 'twice_daily': return 'De 2 ori pe zi';
			case 'weekly': return 'Săptămânal';
			default: return val;
		}
	};

	function formatSyncResults(results: any) {
		if (!results) return null;
		const parts = [];
		if (results.imported > 0) parts.push(`${results.imported} importate`);
		if (results.errors > 0) parts.push(`${results.errors} erori`);
		if (parts.length === 0) parts.push('0 facturi noi');
		return parts.join(', ');
	}
</script>

<div class="container mx-auto max-w-2xl py-8 px-4">
	<div class="mb-6">
		<h1 class="text-2xl font-bold">Gmail Integration</h1>
		<p class="text-muted-foreground">Conectează-te la Gmail pentru a importa automat facturile de la furnizori.</p>
	</div>

	{#if urlSuccess}
		<div class="mb-4 rounded-md bg-green-50 border border-green-200 p-4 text-green-800">
			Gmail conectat cu succes!
		</div>
	{/if}

	{#if urlError}
		<div class="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-red-800">
			Eroare: {urlError}
		</div>
	{/if}

	{#if error}
		<div class="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-red-800">
			{error}
		</div>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Mail class="h-5 w-5" />
				Status Conexiune
			</CardTitle>
			<CardDescription>
				Gestionează conexiunea la contul tău Gmail.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<p class="text-muted-foreground">Se încarcă...</p>
			{:else if status?.connected}
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<CheckCircle2 class="h-5 w-5 text-green-500" />
						<span class="font-medium">Conectat</span>
						<Badge variant="secondary">{status.email}</Badge>
					</div>

					{#if status.lastSyncAt}
						<p class="text-sm text-muted-foreground">
							Ultima sincronizare: {new Date(status.lastSyncAt).toLocaleString('ro-RO')}
						</p>
					{/if}

					{#if status.lastSyncResults}
						<p class="text-sm text-muted-foreground">
							Rezultat: {formatSyncResults(status.lastSyncResults)}
							{#if status.lastSyncResults.timestamp}
								({new Date(status.lastSyncResults.timestamp).toLocaleString('ro-RO')})
							{/if}
						</p>
					{/if}

					<Separator />

					<div class="flex gap-2">
						<Button variant="outline" href="/{tenantSlug}/banking/supplier-invoices/import">
							Importă Facturi
						</Button>
						<Button variant="destructive" onclick={handleDisconnect} disabled={disconnecting}>
							<Unlink class="h-4 w-4 mr-2" />
							{disconnecting ? 'Se deconectează...' : 'Deconectează'}
						</Button>
					</div>
				</div>
			{:else}
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<XCircle class="h-5 w-5 text-gray-400" />
						<span class="text-muted-foreground">Neconectat</span>
					</div>

					<p class="text-sm text-muted-foreground">
						Conectează-te la Gmail pentru a permite importul automat al facturilor de la furnizori
						(cPanel, WHMCS, Hetzner, Google, OVH, DigitalOcean, AWS, etc.).
					</p>

					<Button onclick={handleConnect}>
						<LinkIcon class="h-4 w-4 mr-2" />
						Conectează Gmail
					</Button>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Sync Configuration (only when connected) -->
	{#if status?.connected}
		<Card class="mt-6">
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Settings class="h-5 w-5" />
					Configurare Sincronizare Automată
				</CardTitle>
				<CardDescription>
					Setează cum și când se sincronizează automat facturile din Gmail.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-6">
				<!-- Sync enabled toggle -->
				<div class="flex items-center justify-between">
					<div>
						<Label class="font-medium">Sincronizare automată</Label>
						<p class="text-sm text-muted-foreground">Activează importul automat al facturilor</p>
					</div>
					<Switch bind:checked={syncEnabled} />
				</div>

				{#if syncEnabled}
					<Separator />

					<!-- Sync interval -->
					<div>
						<Label class="mb-2 block font-medium">Frecvență sincronizare</Label>
						<Select type="single" bind:value={syncInterval}>
							<SelectTrigger class="w-[200px]">
								{intervalLabel(syncInterval)}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="daily">Zilnic (5:00 AM)</SelectItem>
								<SelectItem value="twice_daily">De 2 ori pe zi (5:00 AM + 5:00 PM)</SelectItem>
								<SelectItem value="weekly">Săptămânal (Luni, 5:00 AM)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<!-- Date range -->
					<div>
						<Label class="mb-2 block font-medium">Perioada de căutare (zile în urmă)</Label>
						<Input
							type="number"
							min={1}
							max={90}
							bind:value={syncDateRangeDays}
							class="w-[120px]"
						/>
						<p class="text-xs text-muted-foreground mt-1">
							La fiecare sincronizare, caută emailuri din ultimele {syncDateRangeDays} zile
						</p>
					</div>

					<Separator />

					<!-- Parser selection -->
					<div>
						<div class="flex items-center justify-between mb-2">
							<Label class="font-medium">Furnizori de monitorizat</Label>
							<label class="flex items-center gap-2 cursor-pointer text-sm">
								<Checkbox checked={useAllParsers} onCheckedChange={toggleAllParsers} />
								Toți
							</label>
						</div>
						<div class="flex flex-wrap gap-3">
							{#each allParsers as parser}
								<label class="flex items-center gap-2 cursor-pointer">
									<Checkbox
										checked={isParserSelected(parser.id)}
										onCheckedChange={() => toggleSyncParser(parser.id)}
									/>
									<span class="text-sm">{parser.label}</span>
								</label>
							{/each}
						</div>
					</div>
				{/if}

				<Separator />

				<Button onclick={handleSaveConfig} disabled={savingConfig}>
					<Save class="h-4 w-4 mr-2" />
					{savingConfig ? 'Se salvează...' : 'Salvează Configurare'}
				</Button>
			</CardContent>
		</Card>
	{/if}
</div>
