<script lang="ts">
	/**
	 * Creditul de ore, văzut de client. Același limbaj vizual ca modulul din
	 * admin (gauge, chipuri, ledger), dar fără nimic intern: fără tarife pe
	 * specializare, fără cine a făcut ajustarea, fără facturi necreditate.
	 */
	import { getMyHourCredit } from '$lib/remotes/portal-hour-credits.remote';
	import { LEDGER_KIND_LABELS, ceilToStep } from '$lib/logic/hour-credits';
	import HcGauge from '$lib/components/hour-credits/HcGauge.svelte';
	import HcLegend from '$lib/components/hour-credits/HcLegend.svelte';
	import { fmtDate, fmtMinutes } from '$lib/components/hour-credits/hour-credits-format';

	const view = $derived(await getMyHourCredit());
	const available = $derived(view.balanceMinutes - view.reservedMinutes);
	// Aceeași regulă ca în admin: alerta e pe DISPONIBIL, nu pe sold.
	const low = $derived(available < view.lowCreditThresholdMinutes);
	const consumed30 = $derived(
		view.entries
			.filter(
				(e) =>
					e.kind === 'task_consumption' &&
					new Date(e.createdAt).getTime() > Date.now() - 30 * 86_400_000
			)
			.reduce((s, e) => s + Math.abs(e.deltaMinutes), 0)
	);

	function toneOf(kind: string, delta: number): string {
		if (kind === 'expire') return 'var(--hc-chip-mut-bg)';
		return delta > 0 ? 'var(--hc-ok-bg)' : 'var(--hc-err-bg)';
	}
</script>

<div class="hc-widget" style="margin-bottom:14px">
	<div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px">
		<div style="min-width:0">
			<div class="hc-bal-l">Disponibil acum</div>
			<div class="hc-widget-big" class:neg={available < 0}>{fmtMinutes(available)}</div>
			<div class="hc-muted" style="margin-top:4px">
				sold {fmtMinutes(view.balanceMinutes)} · rezervat pe taskuri deschise
				{fmtMinutes(view.reservedMinutes)}
			</div>
		</div>
		{#if low}
			<span class="hc-chip hc-chip-err" style="margin-left:auto;flex:none">Credit scăzut</span>
		{/if}
	</div>

	<HcGauge balance={view.balanceMinutes} reserved={view.reservedMinutes} spent={consumed30} lg />
	<div style="margin-top:12px"><HcLegend /></div>
</div>

<details class="hc-widget hc-how" open={view.entries.length === 0}>
	<summary>Cum funcționează creditul de ore</summary>
	<dl>
		<dt>Ce este</dt>
		<dd>
			Timpul pe care l-ai plătit în avans. 1 oră de credit = 1 oră lucrată, indiferent de tipul
			lucrării.
		</dd>
		<dt>Cum se alimentează</dt>
		<dd>
			Din orele cumpărate: 1 oră cumpărată = 1 oră de credit.
			{#if view.subscriptionRateEur}
				În plus, facturile de abonament plătite se transformă în ore: suma netă, la
				{view.subscriptionRateEur} €/h.
			{/if}
		</dd>
		<dt>Cum se consumă</dt>
		<dd>
			La finalizarea unui task scădem timpul lucrat, rotunjit în sus la {view.stepMinutes} minute. Exemplu:
			20 min lucrate = {fmtMinutes(ceilToStep(20, view.stepMinutes))}.
		</dd>
		<dt>Ce înseamnă „rezervat"</dt>
		<dd>
			Taskurile deschise blochează estimarea lor din sold. Disponibil = sold − rezervat. Nimic nu se
			scade până la finalizare.
		</dd>
		<dt>Dacă se termină creditul</dt>
		<dd>
			Timpul lucrat peste credit se facturează separat, la tariful lucrării, pe factura lunară de
			depășire.
		</dd>
		{#if view.expiryDays > 0}
			<dt>Expirare</dt>
			<dd>
				Orele neconsumate expiră după {view.expiryDays} zile de la alimentare. Consumăm întâi orele cele
				mai vechi.
			</dd>
		{/if}
		<dt>Credit scăzut</dt>
		<dd>Te anunțăm când disponibilul scade sub {fmtMinutes(view.lowCreditThresholdMinutes)}.</dd>
	</dl>
</details>

<div class="hc-tablecard hc-widget" style="padding:0">
	<div class="hc-card-h tight">
		<h3>Istoric</h3>
		<p>Alimentări (facturi plătite, ore cumpărate), consum pe taskuri și ajustări.</p>
	</div>

	{#if view.entries.length === 0}
		<div class="hc-empty"><b>Nicio mișcare încă</b>Creditul tău de ore e gol.</div>
	{:else}
		<div class="hc-tablescroll">
			<table class="hc-table">
				<thead>
					<tr>
						<th>Mișcare</th>
						<th>Data</th>
						<th class="r">Ore</th>
					</tr>
				</thead>
				<tbody>
					{#each view.entries as e (e.id)}
						{@const plus = e.deltaMinutes > 0}
						<tr>
							<td>
								<div class="hc-led-type">
									<span
										class="hc-led-ic"
										style:background={toneOf(e.kind, e.deltaMinutes)}
										style:color={plus ? 'var(--hc-ok-fg)' : 'var(--hc-err-fg)'}
										aria-hidden="true"
									>
										{plus ? '+' : '−'}
									</span>
									<span>{e.note || LEDGER_KIND_LABELS[e.kind] || e.kind}</span>
								</div>
								{#if e.realMinutes && e.kind !== 'purchase'}
									<div class="hc-muted hc-led-sub">{fmtMinutes(e.realMinutes)} lucrate</div>
								{/if}
								{#if e.realMinutes && e.kind === 'task_consumption' && Math.abs(e.deltaMinutes) === ceilToStep(e.realMinutes, view.stepMinutes) && Math.abs(e.deltaMinutes) !== e.realMinutes}
									<div class="hc-muted hc-led-sub">rotunjit în sus la {view.stepMinutes} min</div>
								{/if}
							</td>
							<td class="hc-muted">{fmtDate(e.createdAt)}</td>
							<td class="hc-num {plus ? 'hc-plus' : 'hc-minus'}">
								{plus ? '+' : ''}{fmtMinutes(e.deltaMinutes)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
