import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';
import { notifyPaymentSucceeded } from '$lib/server/stripe/notifications';

/**
 * Marchează achitate facturile unui cont de hosting la înregistrarea unei plăți
 * offline (OP/transfer bancar sau cash) din tab-ul „Plată & Factură".
 *
 * Oglindește pipeline-ul plății cu cardul (stripe/invoice-payment.ts): flip pe
 * `paid` + trio-ul de hook-uri (invoice.updated / invoice.status.changed /
 * invoice.paid), astfel încât plugin-ul DirectAdmin avansează next_due_date cu
 * un ciclu și dez-suspendă contul suspendat pentru factura restantă — gratuit.
 *
 * Siguranță:
 * - acceptă DOAR facturi legate explicit de cont (FK). Facturile istorice fără
 *   FK apar în UI printr-o euristică de atribuire („rough") — a le marca de aici
 *   ar transforma o potrivire de afișare în FK permanent + avans de scadență pe
 *   contul greșit, deci sunt raportate `not_linked`, nu modificate;
 * - flip-ul e atomic: UPDATE condiționat pe statusurile plătibile + verificare
 *   rowsAffected, ca două salvări concurente să nu emită hook-urile de două ori
 *   (echivalentul dedupe-ului processed_stripe_event din fluxul card);
 * - un PaymentIntent Stripe rămas deschis pe factură (creat de linkul public /
 *   portal ÎNAINTE de plată) e anulat best-effort — altfel clientul l-ar putea
 *   confirma ulterior, iar webhook-ul ar trata încasarea drept redelivery
 *   idempotent și banii ar intra dublu, silențios;
 * - un hook căzut nu anulează marcarea (plata e deja confirmată de staff) —
 *   identic cu fluxul card, unde banii sunt deja încasați.
 */

const PAYABLE_STATUSES = ['pending', 'sent', 'overdue', 'partially_paid'];

/** Valori `invoice.paymentMethod` consumate de UI (chip „Transfer") și de maparea Keez. */
const METHOD_TO_INVOICE_VALUE: Record<'op' | 'cash', string> = {
	op: 'transfer',
	cash: 'cash'
};

export type MarkInvoicesPaidParams = {
	tenantId: string;
	userId: string;
	hostingAccountId: string;
	invoiceIds: string[];
	method: 'op' | 'cash';
	reference: string;
};

export type MarkInvoicesPaidResult = {
	marked: Array<{ id: string; invoiceNumber: string }>;
	skipped: Array<{
		id: string;
		invoiceNumber: string | null;
		reason: 'not_found' | 'not_linked' | 'already_paid' | 'not_payable';
	}>;
};

export async function markHostingInvoicesPaid(
	params: MarkInvoicesPaidParams
): Promise<MarkInvoicesPaidResult> {
	const reference = params.reference.trim();
	const result: MarkInvoicesPaidResult = { marked: [], skipped: [] };

	const invoiceIds = [...new Set(params.invoiceIds)];
	if (invoiceIds.length === 0) return result;

	if (!reference) {
		throw new Error(
			'Referința plății (nr. OP / chitanță) este obligatorie pentru marcarea facturilor ca achitate'
		);
	}

	const paymentMethod = METHOD_TO_INVOICE_VALUE[params.method];
	const hooks = getHooksManager();

	for (const invoiceId of invoiceIds) {
		const [existing] = await db
			.select()
			.from(table.invoice)
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, params.tenantId)))
			.limit(1);

		if (!existing) {
			result.skipped.push({ id: invoiceId, invoiceNumber: null, reason: 'not_found' });
			continue;
		}

		if (existing.hostingAccountId !== params.hostingAccountId) {
			result.skipped.push({
				id: invoiceId,
				invoiceNumber: existing.invoiceNumber,
				reason: 'not_linked'
			});
			continue;
		}

		if (existing.status === 'paid') {
			result.skipped.push({
				id: invoiceId,
				invoiceNumber: existing.invoiceNumber,
				reason: 'already_paid'
			});
			continue;
		}

		if (!PAYABLE_STATUSES.includes(existing.status)) {
			result.skipped.push({
				id: invoiceId,
				invoiceNumber: existing.invoiceNumber,
				reason: 'not_payable'
			});
			continue;
		}

		// Flip atomic: statusul plătibil e re-verificat în WHERE, iar rowsAffected=0
		// înseamnă că o cerere concurentă (alt staff / webhook Stripe) a câștigat —
		// nu re-emitem hook-urile (ar avansa scadența a doua oară).
		const updateResult = (await db
			.update(table.invoice)
			.set({
				status: 'paid',
				paidDate: new Date(),
				paymentMethod,
				externalTransactionId: reference,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(table.invoice.id, invoiceId),
					eq(table.invoice.tenantId, params.tenantId),
					inArray(table.invoice.status, PAYABLE_STATUSES)
				)
			)) as { rowsAffected?: number };

		if (updateResult?.rowsAffected === 0) {
			result.skipped.push({
				id: invoiceId,
				invoiceNumber: existing.invoiceNumber,
				reason: 'already_paid'
			});
			continue;
		}

		result.marked.push({ id: invoiceId, invoiceNumber: existing.invoiceNumber });

		logInfo(
			'directadmin',
			`factura ${existing.invoiceNumber} marcată achitată (${params.method}) din contul de hosting`,
			{
				tenantId: params.tenantId,
				metadata: {
					invoiceId,
					hostingAccountId: params.hostingAccountId,
					reference,
					userId: params.userId
				}
			}
		);

		// PaymentIntent deschis pe factură (stampilat la creare de linkul public /
		// portal, înainte de plată): îl anulăm ca să nu mai poată fi confirmat cu
		// cardul după ce staff-ul a înregistrat plata prin OP/cash. Best-effort —
		// dacă anularea eșuează (ex. PI deja succeeded = banii AU intrat pe card în
		// paralel), avertizăm vizibil: e nevoie de refund manual.
		if (existing.stripePaymentIntentId) {
			try {
				const stripe = await getStripeForTenant(params.tenantId);
				await stripe.paymentIntents.cancel(existing.stripePaymentIntentId, {
					cancellation_reason: 'duplicate'
				});
				logInfo(
					'directadmin',
					`PaymentIntent ${existing.stripePaymentIntentId} anulat după plata ${params.method} a facturii ${existing.invoiceNumber}`,
					{ tenantId: params.tenantId, metadata: { invoiceId } }
				);
			} catch (err) {
				logWarning(
					'directadmin',
					`nu am putut anula PaymentIntent-ul ${existing.stripePaymentIntentId} al facturii ${existing.invoiceNumber} după plata ${params.method} — verifică în Stripe dacă nu s-a încasat dublu: ${serializeError(err).message}`,
					{ tenantId: params.tenantId, metadata: { invoiceId } }
				);
			}
		}

		const [updated] = await db
			.select()
			.from(table.invoice)
			.where(eq(table.invoice.id, invoiceId))
			.limit(1);

		if (!updated) continue;

		try {
			await hooks.emit({
				type: 'invoice.updated',
				invoice: updated as never,
				previousInvoice: existing as never,
				tenantId: params.tenantId,
				userId: params.userId
			});
			await hooks.emit({
				type: 'invoice.status.changed',
				invoice: updated as never,
				previousStatus: existing.status,
				newStatus: 'paid',
				tenantId: params.tenantId,
				userId: params.userId
			});
			await hooks.emit({
				type: 'invoice.paid',
				invoice: updated as never,
				tenantId: params.tenantId,
				userId: params.userId
			});
		} catch (err) {
			logError(
				'directadmin',
				`hook-urile de plată au eșuat pentru factura ${existing.invoiceNumber}: ${serializeError(err).message}`,
				{
					tenantId: params.tenantId,
					metadata: { invoiceId, hostingAccountId: params.hostingAccountId }
				}
			);
		}

		// Emailul „Plată primită" către client — același wrapper ca fluxul card
		// (toggle-urile tenantului + dedupe pe viață per factură se aplică acolo).
		// Non-fatal: factura e deja marcată și hook-urile emise; un destinatar
		// lipsă sau un SMTP căzut nu au voie să strice salvarea — adminul poate
		// retrimite manual din email logs.
		try {
			await notifyPaymentSucceeded(params.tenantId, invoiceId);
		} catch (err) {
			logError(
				'directadmin',
				`emailul „Plată primită" a eșuat pentru factura ${existing.invoiceNumber}: ${serializeError(err).message}`,
				{
					tenantId: params.tenantId,
					metadata: { invoiceId, hostingAccountId: params.hostingAccountId }
				}
			);
		}
	}

	return result;
}
