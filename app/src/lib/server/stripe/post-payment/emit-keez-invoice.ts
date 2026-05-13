import { logInfo, logWarning } from '$lib/server/logger';

/**
 * Emitere factură fiscală RO prin Keez pentru o plată Stripe finalizată.
 *
 * Status: STUB Sprint 8.2. Wiring-ul efectiv (creare CRM `invoice` row + push
 * Keez) urmează să fie implementat în coordonare cu plugin-ul Keez existent.
 *
 * Cerințe de design (memoria proiectului):
 *  - `project_keez_400_for_missing_invoice`: detecție corectă 404 vs 400+nu-exista
 *  - `feedback_keez_push_no_overwrite`: la push nu suprascrie description/note/
 *    keezItemExternalId — Keez ignoră itemName, deci ne bazăm pe `keezItemExternalId`
 *    pre-cachat pe `hostingProduct.keezItemExternalId` (de adăugat).
 *  - `project_keez_resilience_2026_04_26`: serializeError walks .cause + retry
 *    pe Turso busy.
 *
 * Returns: payload obiect serializat în `post_payment_step.payload`.
 *
 * TODO post-Sprint 8.2:
 *   1. Determină `lineItems` din `hostingProduct` + cycle pricing
 *   2. Creează `invoice` în CRM cu status='paid', linked la stripeSessionId/
 *      stripePaymentIntentId/stripeSubscriptionId
 *   3. Apelează `keezPlugin.pushInvoice()` cu pattern atomic sync
 *   4. Cache `keezInvoiceId` + `keezSeries` + `keezNumber` pe invoice row
 */
export async function emitKeezFiscalInvoice(params: {
	tenantId: string;
	clientId: string;
	sessionId: string;
	stripePaymentIntentId: string | null;
	stripeSubscriptionId: string | null;
	productId: string;
}): Promise<{ skipped: true; reason: string } | { invoiceId: string; keezExternalId: string }> {
	logWarning(
		'directadmin',
		'emitKeezFiscalInvoice — STUB (Sprint 8.2 not wired). Staff va emite manual prin /invoices.',
		{
			tenantId: params.tenantId,
			metadata: {
				clientId: params.clientId,
				sessionId: params.sessionId,
				productId: params.productId
			}
		}
	);
	logInfo('directadmin', 'Skipping Keez emission until Sprint 8.2 plumbing is complete', {
		tenantId: params.tenantId,
		metadata: { sessionId: params.sessionId }
	});
	return { skipped: true, reason: 'sprint_8_2_pending' };
}
