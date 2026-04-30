<script lang="ts">
	import Sparkline from '../Sparkline.svelte';
	import { Badge } from '$lib/components/ui/badge';

	interface Snapshot {
		date: string;
		spendCents: number; impressions: number; clicks: number; conversions: number;
		cpcCents: number | null; cpaCents: number | null; cplCents: number | null;
		ctr: number | null; roas: number | null; frequency: number | null;
		maturity: string;
	}
	interface Props { tenantSlug: string; campaignId: string; target: any }
	let { tenantSlug, campaignId, target }: Props = $props();

	let snapshots = $state<Snapshot[]>([]);
	let loading = $state(true);

	$effect(() => { load(); });

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/snapshots?campaignId=${campaignId}&days=30`);
			if (res.ok) {
				const data = await res.json();
				snapshots = data.snapshots ?? [];
			}
		} finally { loading = false; }
	}

	const last7 = $derived(snapshots.slice(-7));
	const cpl7 = $derived(last7.map((s) => s.cplCents));
	const spend7 = $derived(last7.map((s) => s.spendCents));
	const conv7 = $derived(last7.map((s) => s.conversions));
	const ctr7 = $derived(last7.map((s) => s.ctr));

	const lastSnap = $derived(snapshots[snapshots.length - 1]);

	const fmt = (c: number | null) => (c === null ? '—' : `${(c / 100).toFixed(2)} RON`);

	function aggregate(snaps: Snapshot[]) {
		if (snaps.length === 0) {
			return { avgCplCents: null, totalSpendCents: 0, totalConv: 0 };
		}
		const cplVals = snaps.map((s) => s.cplCents).filter((v): v is number => typeof v === 'number');
		const avgCplCents =
			cplVals.length > 0 ? Math.round(cplVals.reduce((a, b) => a + b, 0) / cplVals.length) : null;
		const totalSpendCents = snaps.reduce((s, x) => s + x.spendCents, 0);
		const totalConv = snaps.reduce((s, x) => s + x.conversions, 0);
		return { avgCplCents, totalSpendCents, totalConv };
	}

	const today = new Date();
	const todayStr = today.toISOString().slice(0, 10);
	const yesterdayStr = new Date(today.getTime() - 86400_000).toISOString().slice(0, 10);

	const todaySnap = $derived(snapshots.find((s) => s.date === todayStr));
	const yesterdaySnap = $derived(snapshots.find((s) => s.date === yesterdayStr));

	const agg30 = $derived(aggregate(snapshots));
	const agg7 = $derived(aggregate(last7));
	const aggToday = $derived(todaySnap ? aggregate([todaySnap]) : { avgCplCents: null, totalSpendCents: 0, totalConv: 0 });
	const aggYesterday = $derived(yesterdaySnap ? aggregate([yesterdaySnap]) : { avgCplCents: null, totalSpendCents: 0, totalConv: 0 });
</script>

{#if loading}
	<div class="text-muted-foreground">Se încarcă…</div>
{:else if snapshots.length === 0}
	<div class="text-center text-muted-foreground py-8">
		<p>Niciun snapshot încă.</p>
		<p class="text-xs mt-1">Așteaptă cron-ul de noapte sau rulează manual.</p>
	</div>
{:else}
	<section class="space-y-3">
		<h3 class="text-sm font-semibold">Ultimele 7 zile</h3>
		<div class="grid grid-cols-2 gap-3 text-sm">
			<div class="flex items-center gap-2">CPL <Sparkline values={cpl7} ariaLabel="CPL 7 zile" /> {fmt(cpl7[cpl7.length - 1] ?? null)}</div>
			<div class="flex items-center gap-2">Spend <Sparkline values={spend7} ariaLabel="Spend 7 zile" /> {fmt(spend7[spend7.length - 1] ?? null)}</div>
			<div class="flex items-center gap-2">Conv <Sparkline values={conv7} ariaLabel="Conv 7 zile" /> {conv7[conv7.length - 1] ?? '—'}</div>
			<div class="flex items-center gap-2">CTR <Sparkline values={ctr7} ariaLabel="CTR 7 zile" /> {(typeof ctr7[ctr7.length - 1] === 'number' ? (ctr7[ctr7.length - 1]! * 100).toFixed(2) + '%' : '—')}</div>
		</div>
	</section>

	<section class="mt-4 pt-4 border-t">
		<div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
			<div>
				<h3 class="text-sm font-semibold mb-1">30 zile</h3>
				<div class="text-xs space-y-0.5">
					<div>Avg CPL: <span class="font-mono">{fmt(agg30.avgCplCents)}</span></div>
					<div>Target: <span class="font-mono">{fmt(target.targetCplCents)}</span></div>
					<div>Spend: <span class="font-mono">{fmt(agg30.totalSpendCents)}</span></div>
					<div>Conversii: {agg30.totalConv}</div>
				</div>
			</div>
			<div>
				<h3 class="text-sm font-semibold mb-1">7 zile</h3>
				<div class="text-xs space-y-0.5">
					<div>Avg CPL: <span class="font-mono">{fmt(agg7.avgCplCents)}</span></div>
					<div>Spend: <span class="font-mono">{fmt(agg7.totalSpendCents)}</span></div>
					<div>Conversii: {agg7.totalConv}</div>
				</div>
			</div>
			<div>
				<h3 class="text-sm font-semibold mb-1">Ieri</h3>
				{#if yesterdaySnap}
					<div class="text-xs space-y-0.5">
						<div>CPL: <span class="font-mono">{fmt(aggYesterday.avgCplCents)}</span></div>
						<div>Spend: <span class="font-mono">{fmt(aggYesterday.totalSpendCents)}</span></div>
						<div>Conversii: {aggYesterday.totalConv}</div>
					</div>
				{:else}
					<div class="text-xs text-muted-foreground">Fără date</div>
				{/if}
			</div>
			<div>
				<h3 class="text-sm font-semibold mb-1">Azi</h3>
				{#if todaySnap}
					<div class="text-xs space-y-0.5">
						<div>CPL: <span class="font-mono">{fmt(aggToday.avgCplCents)}</span></div>
						<div>Spend: <span class="font-mono">{fmt(aggToday.totalSpendCents)}</span></div>
						<div>Conversii: {aggToday.totalConv}</div>
					</div>
				{:else}
					<div class="text-xs text-muted-foreground">Fără date</div>
				{/if}
			</div>
		</div>
	</section>

	{#if lastSnap}
		<section class="mt-4 pt-4 border-t text-xs text-muted-foreground">
			Ultimul snapshot: {lastSnap.date} · Maturity: <Badge variant="outline" class="text-xs">{lastSnap.maturity}</Badge>
		</section>
	{/if}
{/if}
