<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import Sparkline from './Sparkline.svelte';
	import PerformanceTab from './drawer/PerformanceTab.svelte';
	import EditTargetTab from './drawer/EditTargetTab.svelte';
	import OverridesTab from './drawer/OverridesTab.svelte';
	import HistoryTab from './drawer/HistoryTab.svelte';

	type Tab = 'performance' | 'edit' | 'overrides' | 'history';

	interface TargetSummary {
		id: string;
		clientName: string;
		accountName: string | null;
		accountId: string | null;
		externalCampaignId: string;
		objective: string;
		targetCplCents: number | null;
		latestCplCents: number | null;
		spark7d: Array<number | null>;
		isActive: boolean;
		isMuted: boolean;
		mutedUntil: Date | null;
		snoozeUntil: number | null;
	}
	interface Props {
		summary: TargetSummary;
		tenantSlug: string;
		expanded: boolean;
		onToggle: (id: string) => void;
		onUpdated: () => void;
	}
	let { summary, tenantSlug, expanded, onToggle, onUpdated }: Props = $props();

	let activeTab = $state<Tab>('performance');
	let target = $state<any>(null);
	let lastAudit = $state<{ at: string; actorName: string | null; action: string } | null>(null);
	let loading = $state(false);

	const fmt = (c: number | null) => (c === null ? '—' : `${(c / 100).toFixed(0)} RON`);
	const isSnoozed = $derived(summary.snoozeUntil !== null && summary.snoozeUntil > Date.now());

	async function snooze(days: number) {
		await fetch(`/${tenantSlug}/api/ads-monitor/targets/${summary.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'snooze', days })
		});
		onUpdated();
	}

	async function unsnooze() {
		await fetch(`/${tenantSlug}/api/ads-monitor/targets/${summary.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'unsnooze' })
		});
		onUpdated();
	}

	const deltaPct = $derived(
		summary.targetCplCents && summary.latestCplCents
			? Math.round((summary.latestCplCents / summary.targetCplCents - 1) * 100)
			: null
	);
	const deltaClass = $derived(
		deltaPct === null
			? 'text-muted-foreground'
			: deltaPct > 10
				? 'text-red-600'
				: deltaPct < -10
					? 'text-green-600'
					: 'text-muted-foreground'
	);

	$effect(() => {
		if (expanded && !target && !loading) loadTarget();
	});

	async function loadTarget() {
		loading = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${summary.id}`);
			if (!res.ok) throw new Error('load failed');
			target = await res.json();
			const auditRes = await fetch(
				`/${tenantSlug}/api/ads-monitor/targets/${summary.id}/audit?limit=1`
			);
			if (auditRes.ok) {
				const data = await auditRes.json();
				lastAudit = data.entries[0] ?? null;
			}
		} finally {
			loading = false;
		}
	}

	function onSavedReload() {
		target = null;
		lastAudit = null;
		loadTarget();
		onUpdated();
	}
</script>

<Collapsible open={expanded} onOpenChange={() => onToggle(summary.id)}>
	<Card class="overflow-hidden">
		<CollapsibleTrigger class="w-full text-left cursor-pointer">
			<div class="px-6 py-4">
				<div class="grid grid-cols-[2fr_2fr_1.5fr_1fr_80px_100px_24px] gap-4 items-center">
					<div class="font-medium truncate">{summary.clientName}</div>
					<div class="text-xs">
						{#if summary.accountId}
							<div class="font-mono text-muted-foreground">{summary.accountId}</div>
							{#if summary.accountName}<div class="truncate">{summary.accountName}</div>{/if}
						{:else}
							<Badge variant="outline" class="text-xs">act_? (neasignat)</Badge>
						{/if}
					</div>
					<div class="font-mono text-xs truncate">{summary.externalCampaignId}</div>
					<div class="text-right">
						<div class="text-sm">{fmt(summary.latestCplCents)} / {fmt(summary.targetCplCents)}</div>
						{#if deltaPct !== null}
							<div class="text-xs {deltaClass}">{deltaPct > 0 ? '+' : ''}{deltaPct}%</div>
						{/if}
					</div>
					<div><Sparkline values={summary.spark7d} ariaLabel="CPL ultimele 7 zile" /></div>
					<div class="flex flex-col gap-1 items-start">
						{#if isSnoozed}
							<Badge variant="secondary" class="text-xs">⏸ Snoozed</Badge>
						{:else if summary.isMuted}
							<Badge variant="secondary" class="text-xs">🔇 Mute</Badge>
						{:else if summary.isActive}
							<Badge variant="default" class="text-xs">Activ</Badge>
						{:else}
							<Badge variant="outline" class="text-xs">Inactiv</Badge>
						{/if}
					</div>
					<ChevronDownIcon class="h-5 w-5 text-muted-foreground transition-transform duration-200 {expanded ? 'rotate-180' : ''}" />
				</div>
			</div>
		</CollapsibleTrigger>

		<CollapsibleContent>
			<div class="border-t bg-muted/20">
				{#if loading || !target}
					<div class="p-6 text-muted-foreground text-sm">Se încarcă…</div>
				{:else}
					<div class="px-6 pt-3">
						<div class="flex gap-1 border-b" role="tablist">
							{#each [['performance','Performance'],['edit','Edit'],['overrides','Overrides'],['history','Istoric']] as [val, label]}
								<button
									role="tab"
									aria-selected={activeTab === val}
									class="px-3 py-2 text-sm border-b-2 -mb-px {activeTab === val ? 'border-primary' : 'border-transparent text-muted-foreground'}"
									onclick={() => (activeTab = val as Tab)}
								>{label}</button>
							{/each}
						</div>

						<div class="py-4">
							{#if activeTab === 'performance'}
								<PerformanceTab {tenantSlug} campaignId={target.target.externalCampaignId} target={target.target} />
							{:else if activeTab === 'edit'}
								<EditTargetTab {tenantSlug} target={target.target} onSaved={onSavedReload} />
							{:else if activeTab === 'overrides'}
								<OverridesTab {tenantSlug} target={target.target} onSaved={onSavedReload} />
							{:else if activeTab === 'history'}
								<HistoryTab {tenantSlug} targetId={target.target.id} />
							{/if}
						</div>

						<div class="flex gap-2 items-center border-t pt-3 pb-2">
							<span class="text-xs text-muted-foreground">Snooze:</span>
							{#if isSnoozed}
								<button
									class="text-xs px-2 py-1 rounded border border-input bg-background hover:bg-muted"
									onclick={unsnooze}
								>Anulează snooze</button>
							{:else}
								<button
									class="text-xs px-2 py-1 rounded border border-input bg-background hover:bg-muted"
									onclick={() => snooze(1)}
								>24h</button>
								<button
									class="text-xs px-2 py-1 rounded border border-input bg-background hover:bg-muted"
									onclick={() => snooze(7)}
								>7 zile</button>
							{/if}
						</div>

						{#if lastAudit}
							<div class="text-xs text-muted-foreground border-t py-2">
								Ultima modificare: {lastAudit.actorName ?? lastAudit.action}
								· {new Date(lastAudit.at).toLocaleString('ro-RO')}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</CollapsibleContent>
	</Card>
</Collapsible>
