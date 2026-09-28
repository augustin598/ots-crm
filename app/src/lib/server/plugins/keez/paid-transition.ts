/**
 * Încasarea înregistrată în Keez → eveniment pentru creditul de ore.
 *
 * Plățile făcute prin CRM (card Stripe, OP/cash marcat de staff) emit hook-ul
 * `invoice.paid`, pe care îl ascultă și creditul de ore. Când contabilul
 * înregistrează încasarea direct în Keez, sincronizarea (job-ul zilnic și
 * butonul din Setări → Keez, ambele prin `syncKeezInvoicesForTenant`) scrie
 * `status='paid'` fără niciun hook → ledger-ul rămânea gol, deși clientul avea
 * bifa „facturile plătite alimentează creditul" (bug 2026-09-28, OTS 561).
 *
 * Aici NU se emite hook-ul complet `invoice.paid`: l-ar prinde și plugin-ul
 * DirectAdmin (avansează scadența conturilor de hosting) și notificările staff.
 * Se emite `invoice.paid.synced`, un eveniment îngust pe care îl ascultă doar
 * creditul de ore (`hooks/hour-credit-hooks.ts`), o singură dată, la tranziția
 * în `paid`. Sync-ul nu importă `hour-credits` direct: modulul trage notificări,
 * email și Stripe după el, iar testele de sync ar pica pe lanțul de importuri.
 */
import type { InvoicePaidSyncedEvent } from '../types';
import { logError, serializeError } from '$lib/server/logger';

/** `true` doar când factura devine `paid` din alt status. */
export function isPaidTransition(
	previousStatus: string | null | undefined,
	newStatus: string | null | undefined
): boolean {
	return newStatus === 'paid' && previousStatus !== 'paid';
}

/**
 * Emite `invoice.paid.synced` dacă sincronizarea tocmai a marcat factura
 * încasată. Nu aruncă: sincronizarea trebuie să continue cu restul facturilor,
 * iar o factură necreditată rămâne vizibilă în „Facturi necreditate".
 * Întoarce `true` doar când evenimentul a fost emis fără eroare.
 */
export async function emitKeezPaidTransition(params: {
	tenantId: string;
	invoiceId: string;
	invoiceNumber: string | null | undefined;
	previousStatus: string | null | undefined;
	newStatus: string | null | undefined;
	emit: (event: InvoicePaidSyncedEvent) => Promise<void>;
}): Promise<boolean> {
	if (!isPaidTransition(params.previousStatus, params.newStatus)) return false;
	const label = params.invoiceNumber ?? params.invoiceId;
	try {
		await params.emit({
			type: 'invoice.paid.synced',
			tenantId: params.tenantId,
			invoiceId: params.invoiceId,
			invoiceNumber: params.invoiceNumber ?? null,
			source: 'keez'
		});
		return true;
	} catch (err) {
		logError(
			'keez',
			`invoice.paid.synced pentru factura ${label} a picat — ${serializeError(err).message}`,
			{ tenantId: params.tenantId, metadata: { invoiceId: params.invoiceId } }
		);
		return false;
	}
}
