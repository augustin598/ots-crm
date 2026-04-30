<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import Sparkline from './Sparkline.svelte';

	interface TargetRowData {
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
	}
	interface Props {
		target: TargetRowData;
		onSelect: (id: string) => void;
	}
	let { target, onSelect }: Props = $props();

	const fmt = (c: number | null) => (c === null ? '—' : `${(c / 100).toFixed(0)} RON`);
	const deltaPct = $derived(
		target.targetCplCents && target.latestCplCents
			? Math.round((target.latestCplCents / target.targetCplCents - 1) * 100)
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
</script>

<tr class="border-b hover:bg-muted/20 cursor-pointer" onclick={() => onSelect(target.id)}>
	<td class="px-3 py-2">{target.clientName}</td>
	<td class="px-3 py-2 text-xs">
		{#if target.accountId}
			<div class="font-mono text-muted-foreground">{target.accountId}</div>
			{#if target.accountName}<div>{target.accountName}</div>{/if}
		{:else}
			<Badge variant="outline" class="text-xs">act_? (neasignat)</Badge>
		{/if}
	</td>
	<td class="px-3 py-2 font-mono text-xs">{target.externalCampaignId}</td>
	<td class="px-3 py-2 text-right">
		<div>{fmt(target.latestCplCents)} / {fmt(target.targetCplCents)}</div>
		{#if deltaPct !== null}
			<div class="text-xs {deltaClass}">{deltaPct > 0 ? '+' : ''}{deltaPct}%</div>
		{/if}
	</td>
	<td class="px-3 py-2"><Sparkline values={target.spark7d} ariaLabel="CPL ultimele 7 zile" /></td>
	<td class="px-3 py-2">
		{#if target.isMuted}
			<Badge variant="secondary" class="text-xs">🔇 Mute</Badge>
		{:else if target.isActive}
			<Badge variant="default" class="text-xs">Activ</Badge>
		{:else}
			<Badge variant="outline" class="text-xs">Inactiv</Badge>
		{/if}
	</td>
</tr>
