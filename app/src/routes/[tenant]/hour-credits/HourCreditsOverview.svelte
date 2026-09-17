<script lang="ts">
	/**
	 * „Bugete ore" — lista clienților + taburile de comenzi, facturi necreditate
	 * și raport lunar.
	 *
	 * Fără breadcrumb propriu: layout-ul [tenant] afișează deja breadcrumb-ul
	 * paginii, iar unul în plus l-ar dubla.
	 */
	import { page } from '$app/state';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import {
		creditInvoiceNow,
		getHourCreditsPage,
		getHoursOrdersPage,
		setClientHourCreditFromInvoices
	} from '$lib/remotes/hour-credits.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import HcClientRow from '$lib/components/hour-credits/HcClientRow.svelte';
	import HcLegend from '$lib/components/hour-credits/HcLegend.svelte';
	import HcOrderDrawer from '$lib/components/hour-credits/HcOrderDrawer.svelte';
	import HcAddHoursModal from '$lib/components/hour-credits/HcAddHoursModal.svelte';
	import HcMonthlyReport from '$lib/components/hour-credits/HcMonthlyReport.svelte';
	import HcIssuesPanel from '$lib/components/hour-credits/HcIssuesPanel.svelte';
	import {
		fmtDate,
		fmtHoursShort,
		fmtMinutes,
		fmtMoneyCents
	} from '$lib/components/hour-credits/hour-credits-format';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	const tenantSlug = $derived(page.params.tenant ?? '');
	const data = $derived(await getHourCreditsPage());

	type Tab = 'clients' | 'orders' | 'uncredited' | 'issues' | 'report';
	let tab = $state<Tab>('clients');
	let q = $state('');
	let filter = $state<'all' | 'invoices' | 'low'>('all');
	let selectedOrderId = $state<string | null>(null);
	let addOpen = $state(false);

	// Comenzile se încarcă doar când tabul lor e deschis — lista e pagina care se
	// deschide implicit, n-are rost s-o încetinim cu date pe care nimeni nu le vede.
	const ordersData = $derived(tab === 'orders' ? await getHoursOrdersPage() : null);
	const selectedOrder = $derived(ordersData?.orders.find((o) => o.id === selectedOrderId) ?? null);

	const clientsQuery = getClients();
	const allClients = $derived(
		[...(clientsQuery.current ?? [])]
			.map((c) => ({ id: c.id as string, name: (c.name as string) ?? '' }))
			.sort((a, b) => a.name.localeCompare(b.name, 'ro'))
	);

	// Implicit: clienții cu buget + cei facturați recent (regula e pe server).
	// „Toți clienții" îi aduce și pe ceilalți activi, pentru bifă.
	let showAllClients = $state(false);
	const listed = $derived(
		showAllClients ? data.rows : data.rows.filter((r) => r.tracked || r.lastInvoiceAt)
	);
	// Câți clienți ascunde vederea implicită — pentru contoarele din comutator.
	const hiddenAll = $derived(data.rows.filter((r) => !r.tracked && !r.lastInvoiceAt).length);

	const rows = $derived(
		listed.filter((r) => {
			if (q && !r.clientName.toLowerCase().includes(q.toLowerCase())) return false;
			if (filter === 'invoices') return r.optedIn;
			if (filter === 'low')
				return r.tracked && r.balanceMinutes - r.reservedMinutes < data.lowCreditThresholdMinutes;
			return true;
		})
	);

	const issuesCount = $derived(
		data.issues.unbilledOverages.length +
			data.issues.unsettledDone.length +
			data.issues.cancelledCredited.length +
			data.issues.uninvoicedCredits.length
	);

	let togglingId = $state<string | null>(null);
	let toggleError = $state<string | null>(null);

	async function toggleOptIn(clientId: string, enabled: boolean) {
		togglingId = clientId;
		toggleError = null;
		try {
			await setClientHourCreditFromInvoices({ clientId, enabled }).updates(getHourCreditsPage());
		} catch (err) {
			toggleError = remoteErrorMessage(err, 'Nu am putut salva bifa.');
		} finally {
			togglingId = null;
		}
	}

	let creditingId = $state<string | null>(null);
	let creditError = $state<string | null>(null);

	async function creditNow(invoiceId: string) {
		creditingId = invoiceId;
		creditError = null;
		try {
			await creditInvoiceNow({ invoiceId }).updates(getHourCreditsPage());
		} catch (err) {
			creditError = remoteErrorMessage(err, 'Nu am putut credita factura.');
		} finally {
			creditingId = null;
		}
	}

	/** Export CSV al listei filtrate — ce vede account managerul pe ecran. */
	function exportCsv() {
		const head = [
			'Client',
			'CUI',
			'Sold (min)',
			'Rezervat (min)',
			'Disponibil (min)',
			'Consum 30z (min)',
			'Alimentare din facturi'
		];
		const lines = rows.map((r) =>
			[
				r.clientName,
				r.cui ?? '',
				r.balanceMinutes,
				r.reservedMinutes,
				r.balanceMinutes - r.reservedMinutes,
				r.consumedLast30Minutes,
				r.optedIn ? 'da' : 'nu'
			]
				.map((v) => `"${String(v).replace(/"/g, '""')}"`)
				.join(',')
		);
		const blob = new Blob([[head.join(','), ...lines].join('\n')], {
			type: 'text/csv;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `bugete-ore-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="hc-wrap">
	<div class="hc-hero">
		<div class="hc-in">
			<div class="hc-hero-main">
				<h1>Bugete ore</h1>
				<p class="hc-hero-sub">
					Creditul de ore al fiecărui client: alimentat din facturile plătite, din orele cumpărate
					pe /servicii și din ajustări manuale.
				</p>
				<div class="hc-ref">
					Prag credit scăzut <b>{fmtMinutes(data.lowCreditThresholdMinutes)}</b> · se schimbă din
					<a href="/{tenantSlug}/settings/hourly-rates">Settings → Tarife orare</a>
				</div>
			</div>
			<div class="hc-hero-actions">
				<button type="button" class="hc-btn hc-btn-ghost" onclick={exportCsv}>Export CSV</button>
				{#if data.canEdit}
					<button type="button" class="hc-btn hc-btn-primary" onclick={() => (addOpen = true)}>
						<PlusIcon size={15} /> Adaugă ore unui client
					</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="hc-in">
		<div class="hc-kpis">
			<div class="hc-kpi">
				<div class="hc-kpi-label">Credit în circulație</div>
				<div class="hc-kpi-value">{fmtMinutes(data.kpis.totalBalanceMinutes)}</div>
				<div class="hc-kpi-sub">
					pe <b>{data.kpis.clientCount} clienți</b>
				</div>
			</div>
			<div class="hc-kpi">
				<div class="hc-kpi-label">Rezervat de taskuri</div>
				<div class="hc-kpi-value">{fmtMinutes(data.kpis.totalReservedMinutes)}</div>
				<div class="hc-kpi-sub">estimările taskurilor deschise</div>
			</div>
			<div class="hc-kpi">
				<div class="hc-kpi-label">Sub prag</div>
				<div class="hc-kpi-value" class:warn={data.kpis.lowCount > 0}>{data.kpis.lowCount}</div>
				<div class="hc-kpi-sub">
					disponibil sub <b>{fmtMinutes(data.lowCreditThresholdMinutes)}</b> ·
					{data.kpis.negativeCount} pe minus
				</div>
			</div>
			<div class="hc-kpi">
				<div class="hc-kpi-label">Expiră luna asta</div>
				<div class="hc-kpi-value">{fmtMinutes(data.kpis.expiringThisMonthMinutes)}</div>
				<div class="hc-kpi-sub">
					la <b>{data.kpis.expiringClientCount} clienți</b>
					{data.kpis.expiringClientCount > 0 ? '· anunță-i din timp' : ''}
				</div>
			</div>
		</div>

		<div class="hc-tabs" role="tablist" aria-label="Secțiuni bugete ore">
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'clients'}
				class="hc-tab"
				class:active={tab === 'clients'}
				onclick={() => (tab = 'clients')}
			>
				Clienți <span class="hc-tab-count">{listed.length}</span>
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'orders'}
				class="hc-tab"
				class:active={tab === 'orders'}
				onclick={() => (tab = 'orders')}
			>
				Comenzi ore
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'uncredited'}
				class="hc-tab"
				class:active={tab === 'uncredited'}
				onclick={() => (tab = 'uncredited')}
			>
				Facturi necreditate <span class="hc-tab-count">{data.uncredited.length}</span>
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'issues'}
				class="hc-tab"
				class:active={tab === 'issues'}
				onclick={() => (tab = 'issues')}
			>
				De rezolvat <span class="hc-tab-count">{issuesCount}</span>
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'report'}
				class="hc-tab"
				class:active={tab === 'report'}
				onclick={() => (tab = 'report')}
			>
				Raport lunar
			</button>
		</div>

		{#if tab === 'clients'}
			<div class="hc-toolbar">
				<div class="hc-search">
					<SearchIcon size={15} />
					<input placeholder="Caută client…" bind:value={q} aria-label="Caută client" />
				</div>
				<div class="hc-seg" role="group" aria-label="Filtrează clienții">
					<button
						type="button"
						class:active={filter === 'all'}
						aria-pressed={filter === 'all'}
						onclick={() => (filter = 'all')}>Toți</button
					>
					<button
						type="button"
						class:active={filter === 'invoices'}
						aria-pressed={filter === 'invoices'}
						onclick={() => (filter = 'invoices')}>Cu alimentare din facturi</button
					>
					<button
						type="button"
						class:active={filter === 'low'}
						aria-pressed={filter === 'low'}
						onclick={() => (filter = 'low')}>Sub prag</button
					>
				</div>
				<div class="hc-seg" role="group" aria-label="Ce clienți apar în listă">
					<button
						type="button"
						class:active={!showAllClients}
						aria-pressed={!showAllClients}
						title="Clienții cu buget de ore și cei facturați în ultimele {data.recentInvoiceMonths} luni"
						onclick={() => (showAllClients = false)}
					>
						Activi <span class="hc-tab-count">{data.rows.length - hiddenAll}</span>
					</button>
					<button
						type="button"
						class:active={showAllClients}
						aria-pressed={showAllClients}
						title="Toți clienții activi, inclusiv cei nefacturați recent"
						onclick={() => (showAllClients = true)}
					>
						Toți clienții <span class="hc-tab-count">{data.rows.length}</span>
					</button>
				</div>
				<div class="hc-spacer"></div>
				<HcLegend />
			</div>
			{#if toggleError}
				<div class="hc-error">{toggleError}</div>
			{/if}

			{#if rows.length === 0}
				<div class="hc-tablecard">
					<div class="hc-empty">
						<b>Niciun client pe acest filtru</b>
						{#if listed.length === 0}
							Niciun client cu buget sau facturat recent. Vezi „Toți clienții" sau adaugă ore
							manual.
						{:else}
							Schimbă filtrul sau caută alt nume.
						{/if}
					</div>
				</div>
			{:else}
				<div class="hc-rows">
					{#each rows as row (row.clientId)}
						<HcClientRow
							{row}
							thresholdMinutes={data.lowCreditThresholdMinutes}
							href="/{tenantSlug}/hour-credits/{row.clientId}"
							onToggleOptIn={data.canEdit
								? (enabled: boolean) => toggleOptIn(row.clientId, enabled)
								: null}
							toggling={togglingId === row.clientId}
						/>
					{/each}
				</div>
			{/if}
		{:else if tab === 'orders'}
			<div class="hc-tablecard">
				{#if !ordersData || ordersData.orders.length === 0}
					<div class="hc-empty">
						<b>Nicio comandă de ore</b>
						Comenzile plătite pe /servicii și orele adăugate din admin apar aici.
					</div>
				{:else}
					<div class="hc-tablescroll">
						<table class="hc-table">
							<thead>
								<tr>
									<th>Comandă</th>
									<th>Client</th>
									<th>Specializare / regim</th>
									<th class="r">Ore</th>
									<th class="r">Total</th>
									<th>Status</th>
									<th>Factură</th>
								</tr>
							</thead>
							<tbody>
								{#each ordersData.orders as o (o.id)}
									<tr
										class="clickable"
										onclick={() => (selectedOrderId = o.id)}
										onkeydown={(e) => e.key === 'Enter' && (selectedOrderId = o.id)}
										tabindex="0"
									>
										<td>
											<span class="hc-strong">{o.id.slice(0, 8)}</span>
											<div class="hc-muted">{fmtDate(o.createdAt)}</div>
										</td>
										<td>{o.clientName ?? '—'}</td>
										<td>
											{o.rateLabel}
											<div class="hc-muted">
												{o.modeLabel} · ×{(o.modeMultiplierPct / 100).toFixed(2).replace('.', ',')} →
												{o.rateEur} €/h
											</div>
										</td>
										<td class="hc-num">{fmtHoursShort(o.hours * 60)}</td>
										<td class="hc-num">{fmtMoneyCents(o.grossCents, o.currency)}</td>
										<td>
											<span
												class="hc-chip {o.status === 'paid'
													? 'hc-chip-ok'
													: o.status === 'failed'
														? 'hc-chip-err'
														: 'hc-chip-warn'}"
											>
												{o.status === 'paid'
													? 'Plătită'
													: o.status === 'failed'
														? 'Plată eșuată'
														: 'Așteaptă plata'}
											</span>
										</td>
										<td>
											{#if o.invoiceId}
												<!-- Clicul pe factură nu deschide drawerul. -->
												<a
													href="/{tenantSlug}/invoices/{o.invoiceId}"
													onclick={(e) => e.stopPropagation()}
												>
													{o.invoiceNumber ?? 'factură'}
												</a>
											{:else}
												<span class="hc-muted">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{:else if tab === 'uncredited'}
			<div class="hc-tablecard">
				<div class="hc-card-h tight">
					<h3>Facturi plătite care nu au ajuns în ledger</h3>
					<p>
						Plătite înainte de bifarea alimentării, curs BNR indisponibil sau monedă neacceptată.
						Creditarea e idempotentă — poți reîncerca fără riscul dublării.
					</p>
				</div>
				{#if creditError}
					<div style="padding:0 18px"><div class="hc-error">{creditError}</div></div>
				{/if}
				{#if data.uncredited.length === 0}
					<div class="hc-empty">
						<b>Nimic de creditat</b>Toate facturile eligibile sunt în ledger.
					</div>
				{:else}
					<div class="hc-tablescroll">
						<table class="hc-table">
							<thead>
								<tr>
									<th>Factură</th>
									<th>Client</th>
									<th class="r">Valoare</th>
									<th>Plătită</th>
									<th>De ce nu s-a creditat</th>
									<th class="r"></th>
								</tr>
							</thead>
							<tbody>
								{#each data.uncredited as inv (inv.invoiceId)}
									<tr>
										<td>
											<a href="/{tenantSlug}/invoices/{inv.invoiceId}" class="hc-strong">
												{inv.invoiceNumber ?? inv.invoiceId.slice(0, 8)}
											</a>
										</td>
										<td>{inv.clientName}</td>
										<td class="hc-num">{formatAmount(inv.amount, inv.currency as Currency)}</td>
										<td>{fmtDate(inv.paidDate)}</td>
										<td class="hc-muted">{inv.reason ?? 'plătită înainte de bifare'}</td>
										<td class="r">
											{#if data.canEdit}
												{#if inv.reason?.includes('bifa')}
													<a
														class="hc-btn hc-btn-light"
														href="/{tenantSlug}/hour-credits/{inv.clientId}"
													>
														Bifează alimentarea
													</a>
												{:else}
													<button
														type="button"
														class="hc-btn hc-btn-light"
														disabled={creditingId === inv.invoiceId}
														onclick={() => creditNow(inv.invoiceId)}
													>
														{creditingId === inv.invoiceId ? '…' : 'Reîncearcă creditarea'}
													</button>
												{/if}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{:else if tab === 'issues'}
			<HcIssuesPanel issues={data.issues} {tenantSlug} canEdit={data.canEdit} />
		{:else}
			<HcMonthlyReport />
		{/if}
	</div>
</div>

{#if selectedOrder}
	<HcOrderDrawer order={selectedOrder} {tenantSlug} onclose={() => (selectedOrderId = null)} />
{/if}

{#if addOpen}
	<HcAddHoursModal clients={allClients} onclose={() => (addOpen = false)} />
{/if}
