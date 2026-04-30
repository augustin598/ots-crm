<script lang="ts">
	import { Card } from '$lib/components/ui/card';

	interface Props {
		summary: {
			activeTargets: number;
			pendingRecs: number;
			spend7dCents: number;
			avgCpl30dCents: number | null;
			avgTargetCplCents: number | null;
		};
	}
	let { summary }: Props = $props();

	const fmt = (cents: number) => `${(cents / 100).toFixed(0)} RON`;
	const cplDelta = $derived(
		summary.avgCpl30dCents !== null && summary.avgTargetCplCents !== null
			? summary.avgCpl30dCents - summary.avgTargetCplCents
			: null
	);
	const cplPctDelta = $derived(
		cplDelta !== null && summary.avgTargetCplCents
			? ((cplDelta / summary.avgTargetCplCents) * 100).toFixed(0)
			: null
	);
</script>

<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Active</div>
		<div class="text-2xl font-bold">{summary.activeTargets}</div>
	</Card>
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Pending</div>
		<div class="text-2xl font-bold">
			{summary.pendingRecs}
			{#if summary.pendingRecs > 0}<span class="text-amber-500 text-base">▲</span>{/if}
		</div>
	</Card>
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Spend 7d</div>
		<div class="text-2xl font-bold">{fmt(summary.spend7dCents)}</div>
	</Card>
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Avg CPL 30d</div>
		<div class="text-2xl font-bold">
			{summary.avgCpl30dCents !== null ? fmt(summary.avgCpl30dCents) : '—'}
			{#if summary.avgTargetCplCents !== null}
				<span class="text-sm text-muted-foreground"> / {fmt(summary.avgTargetCplCents)}</span>
			{/if}
		</div>
		{#if cplPctDelta !== null}
			<div class="text-xs {Number(cplPctDelta) > 0 ? 'text-red-600' : 'text-green-600'}">
				{Number(cplPctDelta) > 0 ? '+' : ''}{cplPctDelta}% vs target
			</div>
		{/if}
	</Card>
</div>
