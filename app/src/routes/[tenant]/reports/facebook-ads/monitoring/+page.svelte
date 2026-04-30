<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import TargetIcon from '@lucide/svelte/icons/target';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import KpiStrip from './components/KpiStrip.svelte';
	import TargetFilters from './components/TargetFilters.svelte';
	import TargetCard from './components/TargetCard.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import RejectRecModal from './components/RejectRecModal.svelte';
	import AddTargetForm from './components/AddTargetForm.svelte';
	import DiscoverCampaignsModal from './components/DiscoverCampaignsModal.svelte';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let targets = $state([...data.targets]);
	let recommendations = $state([...data.recommendations]);
	let runningRebuild = $state(false);
	let runningBackfill = $state(false);
	let approvingId = $state<string | null>(null);
	let expandedIds = new SvelteSet<string>();
	function toggleExpand(id: string) {
		if (expandedIds.has(id)) expandedIds.delete(id);
		else expandedIds.add(id);
	}
	let rejectRecId = $state<string | null>(null);
	let rejectModalOpen = $state(false);
	let showAddForm = $state(false);
	let discoverOpen = $state(false);

	let filterClientId = $state('');
	let filterStatus = $state<'all' | 'active' | 'muted' | 'inactive'>('all');
	let filterDeviation = $state<'all' | 'over' | 'under' | 'ok'>('all');
	let filterSearch = $state('');

	const pendingRecs = $derived(recommendations.filter((r) => r.status === 'draft'));
	const decidedRecs = $derived(recommendations.filter((r) => r.status !== 'draft'));

	const filteredTargets = $derived(
		targets.filter((t) => {
			if (filterClientId && t.clientId !== filterClientId) return false;
			if (filterStatus === 'active' && (!t.isActive || t.isMuted)) return false;
			if (filterStatus === 'muted' && !t.isMuted) return false;
			if (filterStatus === 'inactive' && t.isActive) return false;
			if (filterSearch) {
				const q = filterSearch.toLowerCase();
				if (!t.clientName.toLowerCase().includes(q) && !t.externalCampaignId.toLowerCase().includes(q))
					return false;
			}
			if (filterDeviation !== 'all' && t.targetCplCents && (t as any).latestCplCents !== null) {
				const ratio = (t as any).latestCplCents / t.targetCplCents;
				if (filterDeviation === 'over' && ratio <= 1.1) return false;
				if (filterDeviation === 'under' && ratio >= 0.9) return false;
				if (filterDeviation === 'ok' && (ratio < 0.9 || ratio > 1.1)) return false;
			}
			return true;
		})
	);

	const ACTION_LABELS: Record<string, string> = {
		pause_ad: '⏸ Pauză campanie',
		resume_ad: '▶️ Reia campanie',
		increase_budget: '📈 Mărește buget',
		decrease_budget: '📉 Scade buget',
		refresh_creative: '🎨 Refresh creative',
		change_audience: '🎯 Schimbă audiență'
	};

	const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
		draft: { label: 'În așteptare', variant: 'default' },
		approved: { label: 'Aprobat', variant: 'secondary' },
		rejected: { label: 'Respins', variant: 'outline' },
		applied: { label: 'Aplicat ✅', variant: 'secondary' },
		failed: { label: 'Eșuat ❌', variant: 'outline' }
	};

	function safeJsonParse(s: string): Record<string, unknown> {
		try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
	}

	async function approveRecommendation(id: string) {
		if (!confirm('Aprobi această recomandare? Acțiunea va fi aplicată imediat pe Meta.')) return;
		approvingId = id;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/ads-monitor/recommendations/${id}/approve`, { method: 'POST' });
			const body = (await res.json()) as { ok: boolean; error?: string };
			if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			toast.success('Aprobată și aplicată pe Meta.');
			recommendations = recommendations.map((r) =>
				r.id === id ? { ...r, status: 'applied', appliedAt: new Date(), decidedAt: new Date() } : r
			);
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { approvingId = null; }
	}

	function openReject(id: string) { rejectRecId = id; rejectModalOpen = true; }
	function onRecRejected() {
		if (rejectRecId) {
			recommendations = recommendations.map((r) =>
				r.id === rejectRecId ? { ...r, status: 'rejected', decidedAt: new Date() } : r
			);
		}
		rejectRecId = null;
	}

	function refreshAll() {
		window.location.reload();
	}

	async function runMonitorNow() {
		if (runningRebuild) return;
		runningRebuild = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/_debug-ads-monitor-run`, { method: 'POST' });
			const body = (await res.json().catch(() => null)) as
				| { ok: boolean; result?: { processed: number; alerted: number }; error?: string }
				| null;
			if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
			const result = body.result ?? { processed: 0, alerted: 0 };
			toast.success(`Rulat: ${result.processed} target-uri, ${result.alerted} alerte.`);
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { runningRebuild = false; }
	}

	async function runBackfill(daysBack: number, includeToday: boolean, label: string) {
		if (runningBackfill) return;
		const targetClientId = filterClientId || null;
		const clientLabel = targetClientId
			? data.clients.find((c) => c.id === targetClientId)?.name ?? 'client selectat'
			: 'toți clienții';
		if (!confirm(`Backfill «${label}» pentru ${clientLabel} rulează din nou snapshot-urile Meta. Continui?`)) return;
		runningBackfill = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/ads-monitor/backfill`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ daysBack, includeToday, clientId: targetClientId })
			});
			const body = (await res.json().catch(() => null)) as
				| { ok: boolean; result?: { campaignsProcessed: number; daysCovered: number; errors: string[] }; error?: string }
				| null;
			if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
			const result = body.result ?? { campaignsProcessed: 0, daysCovered: daysBack, errors: [] };
			toast.success(`Backfill «${label}» (${clientLabel}): ${result.campaignsProcessed} campanii${result.errors.length > 0 ? ' (' + result.errors.length + ' erori)' : ''}`);
			setTimeout(() => window.location.reload(), 1500);
		} catch (e) {
			toast.error(`Eroare backfill: ${(e as Error).message}`);
		} finally { runningBackfill = false; }
	}
</script>

<svelte:head><title>Monitoring Meta Ads</title></svelte:head>

<div class="container mx-auto p-6 space-y-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<a href="/{data.tenantSlug}/reports/facebook-ads" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeftIcon class="h-4 w-4" /> Înapoi la rapoarte
			</a>
			<h1 class="text-3xl font-bold flex items-center gap-3 mt-2">
				<TargetIcon class="h-7 w-7" /> Monitoring Meta Ads
			</h1>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={() => (discoverOpen = true)} variant="outline" size="sm">
				<DownloadIcon class="h-4 w-4 mr-2" />
				Importă campanii
			</Button>
			<Button onclick={() => (showAddForm = !showAddForm)} variant="default" size="sm">
				<TargetIcon class="h-4 w-4 mr-2" />
				{showAddForm ? 'Închide' : 'Adaugă target'}
			</Button>
			<Button onclick={runMonitorNow} disabled={runningRebuild} variant="outline" size="sm">
				<RefreshCwIcon class="h-4 w-4 mr-2 {runningRebuild ? 'animate-spin' : ''}" /> Rulează acum
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					<Button variant="outline" size="sm" disabled={runningBackfill}>
						<HistoryIcon class="h-4 w-4 mr-2 {runningBackfill ? 'animate-spin' : ''}" />
						Backfill{filterClientId ? ' client' : ''}
						<ChevronDownIcon class="h-3 w-3 ml-1" />
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={() => runBackfill(30, false, '30 zile')}>30 zile</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => runBackfill(7, false, '7 zile')}>7 zile</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => runBackfill(1, false, 'Ieri')}>Ieri (1 zi)</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => runBackfill(1, true, 'Azi')}>Azi</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>

	<KpiStrip summary={data.summary} />

	{#if showAddForm}
		<AddTargetForm
			tenantSlug={data.tenantSlug}
			clients={data.clients}
			onClose={() => (showAddForm = false)}
			onSaved={refreshAll}
		/>
	{/if}

	{#if pendingRecs.length > 0}
		<Card class="p-6 border-amber-500/40 bg-amber-500/5">
			<h2 class="text-xl font-semibold flex items-center gap-2 mb-4">
				<LightbulbIcon class="h-5 w-5 text-amber-500" />
				Recomandări în așteptare ({pendingRecs.length})
			</h2>
			<div class="space-y-3">
				{#each pendingRecs as rec (rec.id)}
					{@const payload = safeJsonParse(rec.suggestedPayloadJson)}
					<div class="rounded-md border bg-background p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1 flex-wrap">
									<Badge>{ACTION_LABELS[rec.action] ?? rec.action}</Badge>
									<span class="text-sm text-muted-foreground">{rec.clientName}</span>
									<span class="text-xs font-mono text-muted-foreground">{rec.externalCampaignId}</span>
								</div>
								<p class="text-sm">{rec.reason}</p>
								{#if Object.keys(payload).length > 0}
									<details class="mt-2">
										<summary class="text-xs text-muted-foreground cursor-pointer">Payload propus</summary>
										<pre class="text-xs bg-muted/50 rounded p-2 mt-1">{JSON.stringify(payload, null, 2)}</pre>
									</details>
								{/if}
							</div>
							<div class="flex flex-col gap-2 min-w-[120px]">
								<Button size="sm" onclick={() => approveRecommendation(rec.id)} disabled={approvingId === rec.id}>
									<CheckIcon class="h-4 w-4 mr-1" /> {approvingId === rec.id ? 'Aplic…' : 'Aprobă'}
								</Button>
								<Button size="sm" variant="outline" onclick={() => openReject(rec.id)}>
									<XIcon class="h-4 w-4 mr-1" /> Respinge
								</Button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}

	<Card class="p-6">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-semibold flex items-center gap-2">
				<IconFacebook class="h-5 w-5" /> Target-uri ({filteredTargets.length}/{targets.length})
			</h2>
		</div>
		<div class="mb-3">
			<TargetFilters
				clients={data.clients}
				bind:clientId={filterClientId}
				bind:status={filterStatus}
				bind:deviation={filterDeviation}
				bind:search={filterSearch}
				onChange={() => {}}
			/>
		</div>

		{#if filteredTargets.length === 0}
			<div class="text-center py-12 text-muted-foreground">
				<TargetIcon class="h-12 w-12 mx-auto mb-3 opacity-50" />
				<p>Niciun target nu se potrivește filtrelor.</p>
			</div>
		{:else}
			<!-- Column headers -->
			<div class="grid grid-cols-[2fr_2fr_1.5fr_1fr_80px_100px_24px] gap-4 px-6 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
				<span>Client</span>
				<span>Ad Account</span>
				<span>Campanie</span>
				<span class="text-right">CPL / Target</span>
				<span>7d</span>
				<span>Stare</span>
				<span></span>
			</div>
			<div class="space-y-2 mt-3">
				{#each filteredTargets as target (target.id)}
					<TargetCard
						summary={target}
						tenantSlug={data.tenantSlug}
						expanded={expandedIds.has(target.id)}
						onToggle={toggleExpand}
						onUpdated={refreshAll}
					/>
				{/each}
			</div>
		{/if}
	</Card>

	{#if decidedRecs.length > 0}
		<Card class="p-6">
			<h2 class="text-xl font-semibold mb-4">Istoric recomandări</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/40">
						<tr class="text-left">
							<th class="px-3 py-2">Data</th>
							<th class="px-3 py-2">Client</th>
							<th class="px-3 py-2">Acțiune</th>
							<th class="px-3 py-2">Stare</th>
						</tr>
					</thead>
					<tbody>
						{#each decidedRecs as rec (rec.id)}
							{@const badge = STATUS_BADGES[rec.status] ?? STATUS_BADGES.draft}
							<tr class="border-b">
								<td class="px-3 py-2 text-xs text-muted-foreground">{new Date(rec.createdAt).toLocaleDateString('ro-RO')}</td>
								<td class="px-3 py-2">{rec.clientName}</td>
								<td class="px-3 py-2">{ACTION_LABELS[rec.action] ?? rec.action}</td>
								<td class="px-3 py-2"><Badge variant={badge.variant} class="text-xs">{badge.label}</Badge></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
</div>

<RejectRecModal
	bind:open={rejectModalOpen}
	recId={rejectRecId}
	tenantSlug={data.tenantSlug}
	onClose={() => (rejectModalOpen = false)}
	onRejected={onRecRejected}
/>

<DiscoverCampaignsModal
	bind:open={discoverOpen}
	clients={data.clients}
	tenantSlug={data.tenantSlug}
	onClose={() => (discoverOpen = false)}
	onImported={refreshAll}
/>
