/**
 * Factura fiscală (CRM + Keez) pentru o comandă de ore de extra work plătită cu
 * cardul de pe /servicii. Clonă adaptată după `emit-keez-invoice.ts` (hosting):
 * aceleași invariante de bani (Stripe.amount == invoice.totalAmount == ce a
 * văzut clientul), aceeași idempotență pe `stripePaymentIntentId`, același
 * push în Keez cu eșec NEfatal (staff retrimite din /invoices/{id}).
 *
 * Diferențe față de hosting:
 *  - sursa banilor e snapshot-ul din `service_hours_order`, nu un produs;
 *  - seria de facturare e cea implicită a tenantului (OTS), nu cea de hosting;
 *  - linia are cantitate = ore, preț unitar = tariful pe oră, UM „Ora" (Keez id 5);
 *  - fără perioadă de facturare, fără domeniu, fără cale de plată prin OP.
 *
 * VALUTA: tarifele sunt în EUR și Stripe încasează EUR, dar Keez refuză facturi
 * în EUR pentru clienți din România („Facturile pentru clientii din Romania
 * trebuie sa fie facute in RON" — verificat pe 26 aug 2026). De aceea factura
 * are ANTET în RON cu cursul BNR blocat la emitere (`invoice.exchangeRate`, ca
 * la generatorul recurent) și LINIA în EUR: mapper-ul Keez trimite sumele în
 * RON (`netAmount`) și referința în EUR (`netAmountCurrency`,
 * `referenceCurrencyCode = EUR`). Fără curs BNR în DB nu emitem — comanda
 * rămâne plătită, adminul vede „Neemisă" și reia manual după sync-ul BNR.
 */
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getNextInvoiceNumberFromPlugin } from '$lib/server/invoice-utils';
import { getLatestBnrRateWithDate } from '$lib/server/bnr/client';
import { pushInvoiceToKeez } from '$lib/server/plugins/keez/auto-push';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { vatPercentToBps } from '$lib/utils/vat';
import { eurCentsToRonCents, formatExchangeRate } from '$lib/logic/hours-pricing';

/** Peste atât cursul e probabil vechi (weekend + sărbătoare = max ~4 zile); avertizăm, nu blocăm. */
const BNR_RATE_WARN_HOURS = 5 * 24;

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Descrierea liniei — nume generic, stabil, ca articolul Keez să fie refolosit. */
export function hoursLineDescription(rateLabel: string): string {
	return `Extra work — ${rateLabel}`;
}

export async function emitKeezHoursInvoice(params: {
	tenantId: string;
	clientId: string;
	orderId: string;
	stripePaymentIntentId: string;
}): Promise<
	| { skipped: true; reason: string }
	| { invoiceId: string; keezExternalId: string | null; invoiceNumber: string }
> {
	const { tenantId, clientId, orderId, stripePaymentIntentId } = params;

	// 1. Comanda (snapshot de bani + ore).
	const [order] = await db
		.select()
		.from(table.serviceHoursOrder)
		.where(
			and(eq(table.serviceHoursOrder.id, orderId), eq(table.serviceHoursOrder.tenantId, tenantId))
		)
		.limit(1);
	if (!order) {
		logError('keez', `emit-keez-hours: comanda ${orderId} nu există`, {
			tenantId,
			metadata: { orderId, stripePaymentIntentId }
		});
		return { skipped: true, reason: 'order_missing' };
	}

	// 2. Idempotență — pe redelivery Stripe nu emitem a doua factură.
	const [existing] = await db
		.select({ id: table.invoice.id, keezExternalId: table.invoice.keezExternalId })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.stripePaymentIntentId, stripePaymentIntentId)
			)
		)
		.limit(1);
	if (existing) {
		logInfo('keez', `emit-keez-hours: factura există deja pentru PI ${stripePaymentIntentId}, skip`, {
			tenantId,
			metadata: { invoiceId: existing.id, orderId }
		});
		return { invoiceId: existing.id, keezExternalId: existing.keezExternalId, invoiceNumber: '' };
	}

	// 3. Owner-ul tenantului — invoice.createdByUserId e NOT NULL.
	const [tenantOwner] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.role, 'owner')))
		.limit(1);
	if (!tenantOwner?.userId) {
		logError('keez', `emit-keez-hours: tenantul ${tenantId} nu are owner — nu putem crea factura`, {
			tenantId,
			metadata: { orderId }
		});
		return { skipped: true, reason: 'tenant_owner_missing' };
	}

	// 4. Bani. Snapshot-ul comenzii e în EUR (ce a încasat Stripe); antetul
	// facturii e în RON la cursul BNR cel mai recent, blocat pe rând.
	if (order.currency !== 'EUR') {
		logError('keez', `emit-keez-hours: valută neașteptată ${order.currency} pe comanda ${orderId}`, {
			tenantId,
			metadata: { orderId }
		});
		return { skipped: true, reason: 'unexpected_currency' };
	}
	const bnr = await getLatestBnrRateWithDate('EUR');
	if (!bnr || !(bnr.rate > 0)) {
		logError('keez', `emit-keez-hours: lipsește cursul BNR EUR — factura pentru comanda ${orderId} NU se emite (reia după sync BNR)`, {
			tenantId,
			metadata: { orderId }
		});
		return { skipped: true, reason: 'bnr_rate_missing' };
	}
	const rateAgeHours = (Date.now() - bnr.rateDate.getTime()) / 3_600_000;
	if (rateAgeHours > BNR_RATE_WARN_HOURS) {
		logWarning('keez', `emit-keez-hours: cursul BNR EUR are ~${Math.round(rateAgeHours)}h — verifică sync-ul BNR`, {
			tenantId,
			metadata: { orderId, rateDate: bnr.rateDate.toISOString() }
		});
	}
	const exchangeRate = bnr.rate;
	const netCents = eurCentsToRonCents(order.netCents, exchangeRate);
	const taxCents = eurCentsToRonCents(order.vatCents, exchangeRate);
	const totalCents = netCents + taxCents;
	const lineTaxRate = vatPercentToBps(order.vatPercent);
	const currency = 'RON';

	// 5. Numărul de factură — seria implicită a tenantului (nu OTSH, orele nu-s hosting).
	let invoiceNumber: string;
	let invoiceSeries: string | null = null;
	try {
		const fromPlugin = await getNextInvoiceNumberFromPlugin(tenantId);
		if (fromPlugin) {
			invoiceNumber = fromPlugin;
			const m = invoiceNumber.match(/^(\D+)\s*(\d+)$/);
			if (m) invoiceSeries = m[1].trim();
		} else {
			invoiceNumber = `INV-${Date.now()}`;
		}
	} catch (err) {
		logError('keez', `emit-keez-hours: getNextInvoiceNumberFromPlugin a eșuat: ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId }
		});
		invoiceNumber = `INV-${Date.now()}`;
	}

	// 6. Cache de articol Keez: ultima linie cu aceeași descriere care are deja
	// un id de articol — echivalentul cache-ului de pe hostingProduct, fără
	// coloană nouă. Fără el, fiecare factură ar crea articol nou în nomenclator.
	const lineDescription = hoursLineDescription(order.rateLabel);
	let cachedArticleId: string | null = null;
	try {
		const [cached] = await db
			.select({ keezItemExternalId: table.invoiceLineItem.keezItemExternalId })
			.from(table.invoiceLineItem)
			.innerJoin(table.invoice, eq(table.invoiceLineItem.invoiceId, table.invoice.id))
			.where(
				and(
					eq(table.invoice.tenantId, tenantId),
					eq(table.invoiceLineItem.description, lineDescription),
					isNotNull(table.invoiceLineItem.keezItemExternalId)
				)
			)
			.orderBy(desc(table.invoice.issueDate))
			.limit(1);
		const id = cached?.keezItemExternalId;
		if (id && /^[a-f0-9]{32}$/i.test(id)) cachedArticleId = id;
	} catch (err) {
		// Doar optimizare — fără cache mergem mai departe.
		logError('keez', `emit-keez-hours: lookup articol Keez eșuat: ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId }
		});
	}

	// 7. INSERT factură + linie, atomic.
	const invoiceId = generateId();
	const lineItemId = generateId();
	const now = new Date();
	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					await tx.insert(table.invoice).values({
						id: invoiceId,
						tenantId,
						clientId,
						createdByUserId: tenantOwner.userId,
						invoiceNumber,
						invoiceSeries,
						status: 'paid',
						amount: netCents,
						taxRate: lineTaxRate,
						taxAmount: taxCents,
						totalAmount: totalCents,
						// Antet RON (cerință Keez pentru clienți RO); `invoiceCurrency` rămâne
						// null la RON, ca la generatorul recurent. Cursul blocat aici e cel pe
						// care îl folosește mapper-ul Keez pentru sumele de referință în EUR.
						currency,
						invoiceCurrency: null,
						exchangeRate: formatExchangeRate(exchangeRate),
						taxApplicationType: 'apply',
						issueDate: now,
						dueDate: now,
						paidDate: now,
						paymentMethod: 'card',
						stripePaymentIntentId,
						notes: `Ore extra work ${order.rateLabel} × ${order.hours} h — comandă online /servicii. Încasat ${(order.grossCents / 100).toFixed(2)} EUR prin card (Stripe ${stripePaymentIntentId}), curs BNR ${formatExchangeRate(exchangeRate)} din ${bnr.rateDate.toISOString().slice(0, 10)}.`
					});

					// Linia rămâne în EUR (tarif × ore); mapper-ul o convertește în RON cu
					// cursul de pe antet și trimite EUR ca `…Currency`.
					await tx.insert(table.invoiceLineItem).values({
						id: lineItemId,
						invoiceId,
						description: lineDescription,
						note: `${order.hours} h × ${order.rateEur} € · Stripe: ${stripePaymentIntentId}`,
						quantity: order.hours,
						rate: order.rateEur * 100,
						amount: order.netCents,
						taxRate: lineTaxRate,
						currency: 'EUR',
						unitOfMeasure: 'Ora',
						keezItemExternalId: cachedArticleId
					});

					await tx
						.update(table.serviceHoursOrder)
						.set({ invoiceId, updatedAt: now })
						.where(
							and(
								eq(table.serviceHoursOrder.id, orderId),
								eq(table.serviceHoursOrder.tenantId, tenantId)
							)
						);
				}),
			{ tenantId, label: 'emit-keez-hours/insertInvoice' }
		);
	} catch (err) {
		logError('keez', `emit-keez-hours: INSERT factură eșuat: ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId, invoiceId }
		});
		return { skipped: true, reason: 'invoice_insert_failed' };
	}

	logInfo('keez', `emit-keez-hours: factura CRM ${invoiceNumber} creată (${invoiceId})`, {
		tenantId,
		metadata: {
			invoiceId,
			invoiceNumber,
			orderId,
			netCents,
			taxCents,
			totalCents,
			currency,
			eurGrossCents: order.grossCents,
			exchangeRate
		}
	});

	// 8. Push în Keez. Eșecul NU anulează factura CRM — staff retrimite din UI.
	let keezExternalId: string | null = null;
	try {
		const pushResult = await pushInvoiceToKeez(tenantId, invoiceId);
		if (pushResult.success) {
			keezExternalId = pushResult.externalId;
			logInfo('keez', `emit-keez-hours: ${invoiceNumber} trimisă în Keez`, {
				tenantId,
				metadata: { invoiceId, keezExternalId }
			});

			// Descrierea din Stripe Dashboard arată factura, ca la hosting.
			try {
				const stripe = await getStripeForTenant(tenantId);
				await stripe.paymentIntents.update(stripePaymentIntentId, {
					description: `Factură ${invoiceNumber} — ${lineDescription} × ${order.hours} h`,
					metadata: {
						crmPurpose: 'hours_purchase',
						crmTenantId: tenantId,
						crmClientId: clientId,
						crmHoursOrderId: orderId,
						crmInvoiceId: invoiceId,
						crmInvoiceNumber: invoiceNumber,
						crmInvoiceSeries: invoiceSeries ?? '',
						keezExternalId: keezExternalId ?? ''
					}
				});
			} catch (err) {
				logError('keez', `emit-keez-hours: PaymentIntent update eșuat: ${serializeError(err).message}`, {
					tenantId,
					metadata: { paymentIntentId: stripePaymentIntentId, invoiceNumber }
				});
			}
		} else {
			logError('keez', `emit-keez-hours: pushInvoiceToKeez !success: ${pushResult.error ?? 'unknown'}`, {
				tenantId,
				metadata: { invoiceId, orderId }
			});
		}
	} catch (err) {
		logError('keez', `emit-keez-hours: push Keez a aruncat: ${serializeError(err).message}`, {
			tenantId,
			metadata: { invoiceId, orderId }
		});
	}

	return { invoiceId, keezExternalId, invoiceNumber };
}
