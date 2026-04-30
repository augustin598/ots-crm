<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import PerformanceTab from './drawer/PerformanceTab.svelte';
	import EditTargetTab from './drawer/EditTargetTab.svelte';
	import OverridesTab from './drawer/OverridesTab.svelte';
	import HistoryTab from './drawer/HistoryTab.svelte';

	type Tab = 'performance' | 'edit' | 'overrides' | 'history';

	interface Props {
		open: boolean;
		targetId: string | null;
		tenantSlug: string;
		onClose: () => void;
		onUpdated: () => void;
	}
	let { open = $bindable(), targetId, tenantSlug, onClose, onUpdated }: Props = $props();

	let activeTab = $state<Tab>('performance');
	let target = $state<any>(null);
	let lastAudit = $state<{ at: string; actorName: string | null; action: string } | null>(null);
	let loading = $state(false);

	$effect(() => {
		if (open && targetId) loadTarget();
	});

	async function loadTarget() {
		loading = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${targetId}`);
			if (!res.ok) throw new Error('load failed');
			target = await res.json();
			const auditRes = await fetch(
				`/${tenantSlug}/api/ads-monitor/targets/${targetId}/audit?limit=1`
			);
			if (auditRes.ok) {
				const data = await auditRes.json();
				lastAudit = data.entries[0] ?? null;
			}
		} finally {
			loading = false;
		}
	}
</script>

<Sheet.Root bind:open onOpenChange={(o) => { if (!o) onClose(); }}>
	<Sheet.Content side="right" class="w-[480px] max-w-full">
		{#if loading || !target}
			<div class="p-6 text-muted-foreground">Se încarcă…</div>
		{:else}
			<Sheet.Header>
				<Sheet.Title>{target.clientName}</Sheet.Title>
				<Sheet.Description class="text-xs">
					{target.accountId ?? 'act_? (neasignat)'} · {target.target.externalCampaignId}
				</Sheet.Description>
			</Sheet.Header>

			<div class="flex gap-1 border-b mt-3" role="tablist">
				{#each [['performance','Performance'],['edit','Edit'],['overrides','Overrides'],['history','Istoric']] as [val, label]}
					<button
						role="tab"
						aria-selected={activeTab === val}
						class="px-3 py-2 text-sm border-b-2 -mb-px {activeTab === val ? 'border-primary' : 'border-transparent text-muted-foreground'}"
						onclick={() => (activeTab = val as Tab)}
					>{label}</button>
				{/each}
			</div>

			<div class="py-4 max-h-[calc(100vh-260px)] overflow-y-auto">
				{#if activeTab === 'performance'}
					<PerformanceTab {tenantSlug} campaignId={target.target.externalCampaignId} target={target.target} />
				{:else if activeTab === 'edit'}
					<EditTargetTab {tenantSlug} target={target.target} onSaved={() => { loadTarget(); onUpdated(); }} />
				{:else if activeTab === 'overrides'}
					<OverridesTab {tenantSlug} target={target.target} onSaved={() => { loadTarget(); onUpdated(); }} />
				{:else if activeTab === 'history'}
					<HistoryTab {tenantSlug} targetId={target.target.id} />
				{/if}
			</div>

			{#if lastAudit}
				<Sheet.Footer class="text-xs text-muted-foreground border-t pt-2">
					Ultima modificare: {lastAudit.actorName ?? lastAudit.action}
					· {new Date(lastAudit.at).toLocaleString('ro-RO')}
				</Sheet.Footer>
			{/if}
		{/if}
	</Sheet.Content>
</Sheet.Root>
