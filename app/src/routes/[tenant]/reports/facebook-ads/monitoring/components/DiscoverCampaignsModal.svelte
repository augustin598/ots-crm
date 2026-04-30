<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { toast } from 'svelte-sonner';
	import { getMetaActiveCampaigns } from '$lib/remotes/reports.remote';

	interface Client {
		id: string;
		name: string;
		accounts: Array<{ adAccountId: string; integrationId: string; accountName: string; isPrimary: boolean }>;
	}
	interface DisplayCampaign {
		campaignId: string;
		campaignName: string;
		status: string;
		objective: string;
		optimizationGoal: string;
		dailyBudget: string | null;
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
	let accountId = $state('');
	let selected = $state<Set<string>>(new Set());
	let importing = $state(false);

	// Default targets (apply to all imports)
	let defaultCpl = $state('');
	let defaultThreshold = $state('20');

	// Live query driven by selected client
	let campaignsQuery = $state<ReturnType<typeof getMetaActiveCampaigns> | null>(null);

	const selectedClient = $derived(clients.find((c) => c.id === clientId) ?? null);
	const availableAccounts = $derived(selectedClient?.accounts ?? []);

	$effect(() => {
		if (availableAccounts.length > 0 && !availableAccounts.find((a) => a.adAccountId === accountId)) {
			accountId = availableAccounts[0].adAccountId;
		} else if (availableAccounts.length === 0) {
			accountId = '';
		}
	});

	const selectedAccount = $derived(availableAccounts.find((a) => a.adAccountId === accountId) ?? null);

	$effect(() => {
		if (selectedAccount && open) {
			campaignsQuery = getMetaActiveCampaigns({
				adAccountId: selectedAccount.adAccountId,
				integrationId: selectedAccount.integrationId
			});
		} else {
			campaignsQuery = null;
		}
	});

	const rawCampaigns = $derived(campaignsQuery?.current ?? []);
	const loading = $derived(campaignsQuery?.loading ?? false);
	const loadError = $derived(campaignsQuery?.error?.message ?? null);

	// Track already-monitored campaign IDs for this client
	let monitoredIds = $state<Set<string>>(new Set());

	$effect(() => {
		if (clientId) {
			fetch(`/${tenantSlug}/api/ads-monitor/targets?clientId=${clientId}`)
				.then((r) => r.json())
				.then((d) => {
					monitoredIds = new Set((d.targets ?? []).map((t: any) => t.externalCampaignId));
				})
				.catch(() => { monitoredIds = new Set(); });
		} else {
			monitoredIds = new Set();
		}
	});

	// Reset selection when client changes
	$effect(() => {
		clientId; // track
		selected = new Set();
	});

	const campaigns = $derived<DisplayCampaign[]>(
		rawCampaigns.map((c: any) => ({
			campaignId: c.campaignId,
			campaignName: c.campaignName,
			status: c.status,
			objective: c.objective,
			optimizationGoal: c.optimizationGoal,
			dailyBudget: c.dailyBudget,
			alreadyMonitored: monitoredIds.has(c.campaignId)
		}))
	);

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
	<Sheet.Content side="right" class="w-[900px] sm:max-w-[900px] max-w-full p-0 flex flex-col gap-0">
		<Sheet.Header class="px-6 pt-6 pb-4 border-b">
			<Sheet.Title>Importă campanii Meta</Sheet.Title>
			<Sheet.Description>Selectează clientul, alege campaniile active și aplică target-uri implicite.</Sheet.Description>
		</Sheet.Header>

		<div class="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-h-0">
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<label class="flex flex-col gap-1 text-sm">
					Client
					<select bind:value={clientId} class="h-9 rounded-md border px-3 bg-background">
						<option value="">Alege client…</option>
						{#each clients as c}
							<option value={c.id}>
								{c.name} ({c.accounts.length} {c.accounts.length === 1 ? 'cont' : 'conturi'})
							</option>
						{/each}
					</select>
				</label>

				{#if selectedClient && availableAccounts.length > 1}
					<label class="flex flex-col gap-1 text-sm">
						Ad Account
						<select bind:value={accountId} class="h-9 rounded-md border px-3 bg-background">
							{#each availableAccounts as a}
								<option value={a.adAccountId}>
									{a.accountName} ({a.adAccountId}){a.isPrimary ? ' · primary' : ''}
								</option>
							{/each}
						</select>
					</label>
				{:else if selectedClient && availableAccounts.length === 1}
					<div class="flex flex-col gap-1 text-sm">
						<span class="text-muted-foreground">Ad Account</span>
						<div class="h-9 rounded-md border px-3 bg-muted/30 flex items-center gap-2 text-xs overflow-hidden">
							<span class="truncate">{availableAccounts[0].accountName}</span>
							<span class="font-mono text-muted-foreground shrink-0">({availableAccounts[0].adAccountId})</span>
						</div>
					</div>
				{/if}
			</div>

			{#if loading}
				<div class="text-sm text-muted-foreground py-8 text-center">Se încarcă campaniile Meta…</div>
			{:else if loadError}
				<div class="text-sm text-red-600 border border-red-200 rounded-md p-3 bg-red-50">⚠ {loadError}</div>
			{:else if campaigns.length === 0 && clientId}
				<div class="text-sm text-muted-foreground py-8 text-center">Nicio campanie activă găsită.</div>
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

				<div class="flex items-center justify-between border-t pt-3">
					<div class="text-sm">
						<span class="font-semibold">{selected.size}</span> selectate · {campaigns.filter((c) => !c.alreadyMonitored).length} disponibile
					</div>
					<button type="button" onclick={selectAllUnmonitored} class="text-xs text-primary hover:underline">
						Selectează toate disponibilele
					</button>
				</div>

				<div class="flex-1 min-h-0 overflow-y-auto border rounded-md divide-y bg-background">
					{#each campaigns as c (c.campaignId)}
						<label class="flex items-start gap-3 p-3 hover:bg-muted/30 cursor-pointer transition-colors {c.alreadyMonitored ? 'opacity-50 cursor-not-allowed' : ''}">
							<input
								type="checkbox"
								checked={selected.has(c.campaignId)}
								disabled={c.alreadyMonitored}
								onchange={() => toggle(c.campaignId)}
								class="mt-0.5 shrink-0"
							/>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium truncate">{c.campaignName}</div>
								<div class="flex items-center gap-2 text-xs text-muted-foreground flex-wrap mt-1">
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

		<Sheet.Footer class="px-6 py-4 border-t bg-muted/20 flex flex-row gap-2 justify-end">
			<Button variant="outline" onclick={onClose}>Anulează</Button>
			<Button onclick={importSelected} disabled={importing || selected.size === 0}>
				{importing ? `Importez…` : `Importă ${selected.size} target-uri`}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
