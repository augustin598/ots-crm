<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { toast } from 'svelte-sonner';

	interface Client { id: string; name: string }
	interface Campaign {
		campaignId: string;
		campaignName: string;
		status: string;
		objective: string;
		optimizationGoal: string;
		dailyBudget: string | null;
		lifetimeBudget: string | null;
		startTime: string | null;
		alreadyMonitored: boolean;
	}
	interface Props {
		open: boolean;
		clients: Client[];
		tenantSlug: string;
		onClose: () => void;
		onImported: () => void;
	}
	let { open = $bindable(), clients, tenantSlug, onClose, onImported }: Props = $props();

	let clientId = $state('');
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let campaigns = $state<Campaign[]>([]);
	let selected = $state<Set<string>>(new Set());
	let importing = $state(false);

	// Default targets (apply to all imports)
	let defaultCpl = $state('');
	let defaultThreshold = $state('20');

	$effect(() => {
		if (!clientId) { campaigns = []; selected = new Set(); return; }
		loadCampaigns();
	});

	async function loadCampaigns() {
		loading = true;
		loadError = null;
		campaigns = [];
		selected = new Set();
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/discover-campaigns?clientId=${clientId}`);
			const body = await res.json();
			if (body.error) loadError = body.error;
			campaigns = body.campaigns ?? [];
		} catch (e) {
			loadError = (e as Error).message;
		} finally { loading = false; }
	}

	function toggle(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		selected = new Set(selected);
	}

	function selectAllUnmonitored() {
		const next = new Set(selected);
		for (const c of campaigns) if (!c.alreadyMonitored) next.add(c.campaignId);
		selected = next;
	}

	async function importSelected() {
		if (selected.size === 0) {
			toast.error('Selectează cel puțin o campanie');
			return;
		}
		const cpl = defaultCpl.trim() ? Math.round(parseFloat(defaultCpl) * 100) : null;
		if (defaultCpl.trim() && (cpl === null || !isFinite(cpl))) {
			toast.error('CPL implicit invalid');
			return;
		}
		const threshold = parseInt(defaultThreshold, 10) || 20;

		importing = true;
		let ok = 0, fail = 0;
		try {
			const toImport = campaigns.filter((c) => selected.has(c.campaignId) && !c.alreadyMonitored);
			for (const c of toImport) {
				try {
					const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							clientId,
							externalCampaignId: c.campaignId,
							objective: c.objective || 'OUTCOME_LEADS',
							targetCplCents: cpl,
							deviationThresholdPct: threshold,
							notifyTelegram: true,
							notifyEmail: true,
							notifyInApp: true
						})
					});
					if (res.ok) ok++; else fail++;
				} catch { fail++; }
			}
			toast.success(`Importat: ${ok} target-uri${fail > 0 ? ' (' + fail + ' erori)' : ''}`);
			onImported();
			onClose();
		} finally { importing = false; }
	}
</script>

<Sheet.Root bind:open onOpenChange={(o) => { if (!o) onClose(); }}>
	<Sheet.Content side="right" class="w-[600px] max-w-full">
		<Sheet.Header>
			<Sheet.Title>Importă campanii Meta</Sheet.Title>
			<Sheet.Description>Selectează clientul, alege campaniile active și aplică target-uri implicite.</Sheet.Description>
		</Sheet.Header>

		<div class="space-y-4 py-4">
			<label class="flex flex-col gap-1 text-sm">
				Client
				<select bind:value={clientId} class="h-9 rounded-md border px-3 bg-background">
					<option value="">Alege client…</option>
					{#each clients as c}<option value={c.id}>{c.name}</option>{/each}
				</select>
			</label>

			{#if loading}
				<div class="text-sm text-muted-foreground py-4">Se încarcă campaniile Meta…</div>
			{:else if loadError}
				<div class="text-sm text-red-600 border border-red-200 rounded p-3 bg-red-50">⚠ {loadError}</div>
			{:else if campaigns.length === 0 && clientId}
				<div class="text-sm text-muted-foreground py-4">Nicio campanie activă găsită.</div>
			{:else if campaigns.length > 0}
				<div class="grid grid-cols-2 gap-3">
					<label class="flex flex-col gap-1 text-sm">
						CPL țintă implicit (RON, opțional)
						<input bind:value={defaultCpl} type="number" step="0.01" placeholder="ex: 30" class="h-9 rounded-md border px-3 bg-background" />
					</label>
					<label class="flex flex-col gap-1 text-sm">
						Prag deviație (%)
						<input bind:value={defaultThreshold} type="number" min="5" max="100" class="h-9 rounded-md border px-3 bg-background" />
					</label>
				</div>

				<div class="flex items-center justify-between">
					<div class="text-sm">
						{selected.size} selectate · {campaigns.filter((c) => !c.alreadyMonitored).length} disponibile
					</div>
					<button type="button" onclick={selectAllUnmonitored} class="text-xs text-primary hover:underline">
						Selectează toate disponibilele
					</button>
				</div>

				<div class="space-y-1 max-h-[400px] overflow-y-auto border rounded">
					{#each campaigns as c (c.campaignId)}
						<label class="flex items-start gap-2 p-2 hover:bg-muted/30 border-b last:border-0 {c.alreadyMonitored ? 'opacity-50' : ''}">
							<input
								type="checkbox"
								checked={selected.has(c.campaignId)}
								disabled={c.alreadyMonitored}
								onchange={() => toggle(c.campaignId)}
								class="mt-1"
							/>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium truncate">{c.campaignName}</div>
								<div class="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
									<span class="font-mono">{c.campaignId}</span>
									<Badge variant="outline" class="text-xs">{c.objective}</Badge>
									{#if c.optimizationGoal}<Badge variant="outline" class="text-xs">{c.optimizationGoal}</Badge>{/if}
									{#if c.alreadyMonitored}<Badge variant="secondary" class="text-xs">deja monitorizat</Badge>{/if}
								</div>
							</div>
						</label>
					{/each}
				</div>
			{/if}
		</div>

		<Sheet.Footer>
			<Button variant="outline" onclick={onClose}>Anulează</Button>
			<Button onclick={importSelected} disabled={importing || selected.size === 0}>
				{importing ? `Importez…` : `Importă ${selected.size} target-uri`}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
