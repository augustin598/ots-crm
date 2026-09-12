<script lang="ts">
	/**
	 * Widgetul de Dashboard: cine rămâne fără ore, dintr-o privire.
	 * Datele vin din același query ca pagina — fără interogare separată.
	 */
	import { getHourCreditsPage } from '$lib/remotes/hour-credits.remote';
	import HcGauge from './HcGauge.svelte';
	import { fmtMinutes } from './hour-credits-format';

	let { tenantSlug }: { tenantSlug: string } = $props();

	const data = $derived(await getHourCreditsPage());
	const low = $derived(
		data.rows
			.filter((r) => r.balanceMinutes - r.reservedMinutes < data.lowCreditThresholdMinutes)
			.slice(0, 3)
	);
</script>

<div class="hc-widget">
	<div class="hc-widget-h">
		<div class="hc-widget-title">Bugete ore</div>
		{#if data.kpis.lowCount > 0}
			<span class="hc-chip hc-chip-err">{data.kpis.lowCount} sub prag</span>
		{:else}
			<span class="hc-chip hc-chip-ok">toți peste prag</span>
		{/if}
		<a class="hc-widget-link" href="/{tenantSlug}/hour-credits">Vezi toate</a>
	</div>

	<div class="hc-bal-l">Credit total în circulație</div>
	<div class="hc-widget-total">{fmtMinutes(data.kpis.totalBalanceMinutes)}</div>

	{#if low.length === 0}
		<p class="hc-muted">Niciun client sub prag.</p>
	{:else}
		<div class="hc-widget-list">
			{#each low as c (c.clientId)}
				<div>
					<div class="hc-mini">
						<span style="font-weight:600;color:var(--cl-text)">{c.clientName}</span>
						<span class={c.balanceMinutes < 0 ? 'hc-minus' : ''}>
							{fmtMinutes(c.balanceMinutes - c.reservedMinutes)} disponibil
						</span>
					</div>
					<HcGauge
						balance={c.balanceMinutes}
						reserved={c.reservedMinutes}
						spent={c.consumedLast30Minutes}
					/>
				</div>
			{/each}
		</div>
	{/if}
</div>
