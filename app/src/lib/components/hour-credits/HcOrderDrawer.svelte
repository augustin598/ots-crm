<script lang="ts">
	/**
	 * Detaliul unei comenzi de ore. Antetul închis e singurul fundal întunecat
	 * păstrat în light — e un panou, nu un header de pagină (handoff §4).
	 */
	import XIcon from '@lucide/svelte/icons/x';
	import { fmtDate, fmtHoursShort, fmtMinutes, fmtMoneyCents } from './hour-credits-format';

	interface Order {
		id: string;
		clientId: string | null;
		clientName: string | null;
		rateLabel: string;
		modeSlug: string;
		modeLabel: string;
		modeMultiplierPct: number;
		modeSla: string | null;
		rateEur: number;
		hours: number;
		netCents: number;
		vatCents: number;
		grossCents: number;
		currency: string;
		status: string;
		requestedWindow: string | null;
		invoiceId: string | null;
		invoiceNumber: string | null;
		createdAt: Date | string;
		credited: boolean;
		/** Minutele creditate (din ledger) sau, înainte de plată, orele comandate: 1 h cumpărată = 1 h de credit. */
		creditMinutes: number | null;
	}

	let { order, tenantSlug, onclose }: { order: Order; tenantSlug: string; onclose: () => void } =
		$props();

	const STATUS: Record<string, [string, string]> = {
		paid: ['hc-chip-ok', 'Plătită'],
		pending_payment: ['hc-chip-warn', 'Așteaptă plata'],
		failed: ['hc-chip-err', 'Plată eșuată'],
		cancelled: ['hc-chip-mut', 'Anulată']
	};
	const chip = $derived(STATUS[order.status] ?? ['hc-chip-mut', order.status]);
	// Orele comandate. Intră 1:1 în credit (`order.creditMinutes`), indiferent de specializare.
	const orderedMinutes = $derived(order.hours * 60);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<!-- Overlay-ul închide; clicul în panou nu. -->
<div
	class="hc-ovl"
	role="button"
	tabindex="-1"
	aria-label="Închide detaliul comenzii"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Enter' && onclose()}
>
	<div
		class="hc-drawer"
		role="dialog"
		aria-modal="true"
		aria-label="Comandă ore {order.id}"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="hc-drawer-h">
			<div>
				<h3>Comandă ore</h3>
				<p>{order.clientName ?? 'fără client'} · {fmtDate(order.createdAt)}</p>
			</div>
			<button type="button" class="hc-x" aria-label="Închide" onclick={onclose}>
				<XIcon size={15} />
			</button>
		</div>

		<div class="hc-drawer-b">
			<div class="hc-card">
				<div class="hc-card-b">
					<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
						<span class="hc-chip {chip[0]}">{chip[1]}</span>
						<span class="hc-chip hc-chip-info">
							{order.modeLabel} · ×{(order.modeMultiplierPct / 100).toFixed(2).replace('.', ',')}
						</span>
						<div class="hc-total">
							<div class="hc-total-l">Total</div>
							<div class="hc-total-v">{fmtMoneyCents(order.grossCents, order.currency)}</div>
						</div>
					</div>

					<dl class="hc-kv">
						<dt>Specializare</dt>
						<dd>{order.rateLabel}</dd>
						<dt>Ore cumpărate</dt>
						<dd>{fmtHoursShort(orderedMinutes)} → {fmtMinutes(orderedMinutes)} lucrate</dd>
						<dt>Tarif efectiv</dt>
						<dd>
							{order.rateEur} €/h
							<span class="hc-muted">(bază × multiplicator regim)</span>
						</dd>
						<dt>Net / TVA</dt>
						<dd>
							{fmtMoneyCents(order.netCents, order.currency)} + {fmtMoneyCents(
								order.vatCents,
								order.currency
							)}
						</dd>
						<dt>Fereastra cerută</dt>
						<dd>{order.requestedWindow ?? '—'}</dd>
						<dt>SLA regim</dt>
						<dd>{order.modeSla ?? '—'}</dd>
						<dt>Factură</dt>
						<dd>
							{#if order.invoiceId}
								<a href="/{tenantSlug}/invoices/{order.invoiceId}">
									{order.invoiceNumber ?? 'vezi factura'}
								</a>
							{:else}
								<span class="hc-muted">emisă la confirmarea plății</span>
							{/if}
						</dd>
					</dl>
				</div>
			</div>

			<div class="hc-card">
				<div class="hc-card-h">
					<h3>Efect asupra creditului</h3>
					<p>
						Orele intră în ledger doar după confirmarea plății. Creditarea e idempotentă — o reluare
						nu dublează soldul.
					</p>
				</div>
				<div class="hc-card-b">
					<div class="hc-preview">
						{#if order.credited}
							Creditat: <b>+{fmtMinutes(order.creditMinutes ?? 0)}</b> în soldul clientului.
						{:else if order.creditMinutes !== null}
							În așteptare: <b>{fmtMinutes(order.creditMinutes)}</b> se adaugă automat când plata e confirmată
							(1 oră cumpărată = 1 oră de credit).
						{:else}
							În așteptare: creditul se calculează la confirmarea plății.
						{/if}
					</div>
					{#if order.clientId}
						<a class="hc-btn hc-btn-primary" href="/{tenantSlug}/hour-credits/{order.clientId}">
							Deschide creditul clientului
						</a>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
