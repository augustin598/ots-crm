<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';

	interface Entry {
		id: string; actorType: string; actorId: string; actorName: string | null;
		action: string; changesJson: string; note: string | null; metadataJson: string; at: string;
	}
	interface Props { tenantSlug: string; targetId: string }
	let { tenantSlug, targetId }: Props = $props();

	let entries = $state<Entry[]>([]);
	let offset = $state(0);
	let hasMore = $state(true);
	let loading = $state(false);

	onMount(() => { load(); });

	async function load() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const res = await fetch(
				`/${tenantSlug}/api/ads-monitor/targets/${targetId}/audit?limit=20&offset=${offset}`
			);
			if (res.ok) {
				const data = await res.json();
				entries = [...entries, ...data.entries];
				hasMore = data.entries.length === 20;
				offset += data.entries.length;
			}
		} finally { loading = false; }
	}

	function diffPairs(json: string): Array<[string, unknown, unknown]> {
		try {
			const parsed = JSON.parse(json) as Record<string, { from: unknown; to: unknown }>;
			return Object.entries(parsed).map(([k, v]) => [k, v.from, v.to]);
		} catch { return []; }
	}

	function fmtVal(v: unknown): string {
		if (v === null || v === undefined) return '—';
		if (Array.isArray(v)) return v.length === 0 ? '[]' : v.join(', ');
		return String(v);
	}
</script>

<div class="space-y-3">
	{#each entries as e (e.id)}
		<div class="text-sm border-l-2 pl-3 py-1 {e.actorType === 'worker' ? 'border-amber-500' : e.actorType === 'system' ? 'border-blue-500' : 'border-primary'}">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<span>{new Date(e.at).toLocaleString('ro-RO')}</span>
				<span>·</span>
				<Badge variant="outline" class="text-xs">{e.actorType}</Badge>
				<span>{e.actorName ?? e.actorId}</span>
				<Badge class="text-xs">{e.action}</Badge>
			</div>
			{#each diffPairs(e.changesJson) as [field, from, to]}
				<div class="text-xs"><span class="text-muted-foreground">{field}:</span> {fmtVal(from)} → {fmtVal(to)}</div>
			{/each}
			{#if e.note}
				<p class="text-xs italic mt-1 text-muted-foreground">„{e.note}"</p>
			{/if}
		</div>
	{/each}
	{#if hasMore}
		<button onclick={load} disabled={loading} class="text-xs text-primary hover:underline">
			{loading ? 'Se încarcă…' : 'Încarcă mai mult'}
		</button>
	{/if}
	{#if entries.length === 0 && !loading}
		<p class="text-muted-foreground text-sm">Niciun eveniment în istoric.</p>
	{/if}
</div>
