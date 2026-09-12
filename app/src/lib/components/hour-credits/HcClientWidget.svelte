<!--
	Cardul de credit din panoul clientului (handoff §5).

	`.current`, nu `await`: pagina clientului nu are boundary și încarcă mai multe
	query-uri independent — un `await` aici ar bloca tot randarea paginii.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getClientHourCreditView } from '$lib/remotes/hour-credits.remote';
	import HcGauge from './HcGauge.svelte';
	import { fmtMinutes } from './hour-credits-format';

	let { clientId }: { clientId: string } = $props();

	const tenantSlug = $derived(page.params.tenant ?? '');
	const query = $derived(getClientHourCreditView(clientId));
	const view = $derived(query.current);

	const available = $derived(view ? view.balanceMinutes - view.reservedMinutes : 0);
	const consumed30 = $derived(
		view
			? view.entries
					.filter(
						(e) =>
							e.kind === 'task_consumption' &&
							new Date(e.createdAt).getTime() > Date.now() - 30 * 86_400_000
					)
					.reduce((s, e) => s + Math.abs(e.deltaMinutes), 0)
			: 0
	);
</script>

<div class="hc-widget">
	<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">
		<div style="min-width:0">
			<div class="hc-bal-l">Credit de ore</div>
			{#if view}
				<div class="hc-widget-big" class:neg={available < 0}>{fmtMinutes(available)}</div>
				<div class="hc-muted" style="margin-top:3px">
					disponibil · sold {fmtMinutes(view.balanceMinutes)} · rezervat
					{fmtMinutes(view.reservedMinutes)}
				</div>
			{:else}
				<div class="hc-widget-big">—</div>
				<div class="hc-muted" style="margin-top:3px">se încarcă…</div>
			{/if}
		</div>
		{#if view}
			<span
				class="hc-chip {view.optedIn ? 'hc-chip-ok' : 'hc-chip-mut'}"
				style="margin-left:auto;flex:none"
			>
				{view.optedIn ? 'Alimentare din facturi' : 'Fără alimentare'}
			</span>
		{/if}
	</div>

	{#if view}
		<HcGauge balance={view.balanceMinutes} reserved={view.reservedMinutes} spent={consumed30} lg />
	{/if}

	<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
		<a class="hc-btn hc-btn-primary" href="/{tenantSlug}/hour-credits/{clientId}">Adaugă ore</a>
		<a class="hc-btn hc-btn-light" href="/{tenantSlug}/hour-credits/{clientId}">Ledger complet</a>
	</div>
</div>
