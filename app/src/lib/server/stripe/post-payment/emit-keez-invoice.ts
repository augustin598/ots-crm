import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getNextInvoiceNumberFromPlugin } from '$lib/server/invoice-utils';
import { pushInvoiceToKeez } from '$lib/server/plugins/keez/auto-push';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { buildRecurringLineItem } from '$lib/server/hosting/recurring-line-item';
import { DEFAULT_VAT_PERCENT } from '$lib/server/vat/rate';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Emit a Romanian fiscal invoice via Keez for a completed Stripe payment.
 *
 * Flow:
 *   1. Resolve product + client + tenant tax rate.
 *   2. Build invoice money: `priceCents` is the NET amount (per
 *      `hostingProduct.price` schema); compute VAT + total.
 *   3. Generate the next invoice number for the tenant (Keez-aware fallback).
 *   4. Idempotency: skip if an invoice already exists linked to this
 *      `stripePaymentIntentId` (re-run after webhook retry shouldn't double-bill).
 *   5. INSERT `invoice` (status='paid', paidDate=now) + one `invoice_line_item`.
 *   6. Push to Keez via `pushInvoiceToKeez` (creates Keez Draft, marks
 *      invoice.keezExternalId on success).
 *
 * Returns `{ invoiceId, keezExternalId }` on success, or
 * `{ skipped: true, reason }` when an upstream pre-condition makes emission
 * impossible (missing product, missing client email, no Keez integration).
 *
 * NOT in scope here:
 *   - Subscription RENEWAL invoices — they come through `invoice.payment_succeeded`
 *     webhook and need a separate emitter wired into `handleInvoicePaid`.
 *   - Stornare (cancel/refund) — admin path, not auto-triggered.
 *   - e-Factura ANAF SPV upload — separate plugin handles that on its own cadence.
 */
export async function emitKeezFiscalInvoice(params: {
	tenantId: string;
	clientId: string;
	sessionId: string;
	inquiryId?: string; // optional — used to fetch requestedDomain for line item label
	stripePaymentIntentId: string | null;
	stripeSubscriptionId: string | null;
	productId: string;
}): Promise<
	| { skipped: true; reason: string }
	| { invoiceId: string; keezExternalId: string | null; invoiceNumber: string }
> {
	const { tenantId, clientId, sessionId, inquiryId, stripePaymentIntentId, stripeSubscriptionId, productId } =
		params;

	// Pull customer-supplied domain + payment method context from the inquiry.
	// Domain shows on the line note for customer recognition. Payment method
	// drives note format: card → "Stripe: pi_xxx"; bank transfer → "Bank: ref".
	let customerDomain = '';
	let inquiryPaymentMethod: string | null = null;
	let inquiryPaymentReference: string | null = null;
	if (inquiryId) {
		const [inq] = await db
			.select({
				requestedDomain: table.hostingInquiry.requestedDomain,
				paymentMethod: table.hostingInquiry.paymentMethod,
				paymentReference: table.hostingInquiry.paymentReference
			})
			.from(table.hostingInquiry)
			.where(
				and(
					eq(table.hostingInquiry.id, inquiryId),
					eq(table.hostingInquiry.tenantId, tenantId)
				)
			)
			.limit(1);
		customerDomain = inq?.requestedDomain?.trim() ?? '';
		inquiryPaymentMethod = inq?.paymentMethod ?? null;
		inquiryPaymentReference = inq?.paymentReference ?? null;
	}

	// 1. Resolve product (price + currency + name + cached Keez article).
	// hostingProduct.keezItemExternalId caches the Keez article id after the
	// first push so subsequent invoices reuse it (no `· #OTSH-xxxx` suffix).
	const [product] = await db
		.select({
			id: table.hostingProduct.id,
			name: table.hostingProduct.name,
			description: table.hostingProduct.description,
			price: table.hostingProduct.price, // cents (smallest currency unit)
			currency: table.hostingProduct.currency,
			billingCycle: table.hostingProduct.billingCycle,
			keezItemExternalId: table.hostingProduct.keezItemExternalId
		})
		.from(table.hostingProduct)
		.where(
			and(
				eq(table.hostingProduct.id, productId),
				eq(table.hostingProduct.tenantId, tenantId)
			)
		)
		.limit(1);
	if (!product) {
		logError('keez', `emit-keez: hostingProduct ${productId} not found`, {
			tenantId,
			metadata: { sessionId, productId }
		});
		return { skipped: true, reason: 'product_missing' };
	}

	// 2. Idempotency — if an invoice already exists for this PI / session, skip.
	if (stripePaymentIntentId) {
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
			logInfo('keez', `emit-keez: invoice already exists for PI ${stripePaymentIntentId}, skip`, {
				tenantId,
				metadata: { invoiceId: existing.id, keezExternalId: existing.keezExternalId }
			});
			return {
				invoiceId: existing.id,
				keezExternalId: existing.keezExternalId,
				invoiceNumber: ''
			};
		}
	}

	// 3. Resolve tenant VAT rate from `invoice_settings.defaultTaxRate`.
	// Defaults to 19% if no settings row exists.
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatPercent = settings?.defaultTaxRate ?? DEFAULT_VAT_PERCENT;

	// Tenant owner — required for invoice.createdByUserId (NOT NULL).
	const [tenantOwner] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.role, 'owner')))
		.limit(1);
	if (!tenantOwner?.userId) {
		logError('keez', `emit-keez: tenant ${tenantId} has no owner — cannot create invoice`, {
			tenantId,
			metadata: { sessionId, productId }
		});
		return { skipped: true, reason: 'tenant_owner_missing' };
	}
	const systemUserId = tenantOwner.userId;

	// 4. Money math. `product.price` is NET in smallest currency unit (bani for RON).
	const netCents = Number(product.price);
	const taxCents = Math.round((netCents * vatPercent) / 100);
	const totalCents = netCents + taxCents;
	// invoice_line_item.taxRate stores the percentage *100 (e.g. 1900 for 19%, 2100 for 21%).
	const lineTaxRate = vatPercent * 100;

	// 5. Generate invoice number — prefer the HOSTING series (`OTSH` in OTS tenant)
	// over the default series (`OTS`). Falls back to default if hosting series
	// isn't configured, and ultimately to `INV-{ts}` if Keez isn't reachable.
	let invoiceNumber: string;
	let invoiceSeries: string | null = null;
	try {
		const fromPlugin = await getNextInvoiceNumberFromPlugin(tenantId, undefined, { isHosting: true });
		if (fromPlugin) {
			invoiceNumber = fromPlugin;
			// Split "OTSH 12" or "OTSH12" into series + number for storage.
			const m = invoiceNumber.match(/^(\D+)\s*(\d+)$/);
			if (m) invoiceSeries = m[1].trim();
		} else {
			invoiceNumber = `INV-${Date.now()}`;
		}
	} catch (err) {
		const { message } = serializeError(err);
		logError('keez', `emit-keez: getNextInvoiceNumberFromPlugin failed: ${message}`, {
			tenantId,
			metadata: { sessionId, productId }
		});
		invoiceNumber = `INV-${Date.now()}`;
	}

	// 6. INSERT invoice + line item atomically.
	const invoiceId = generateId();
	const lineItemId = generateId();
	const now = new Date();
	const issueDate = now;
	const dueDate = now; // paid immediately — Stripe settled before this runs

	// Compute the billing period covered by this charge — used in the line
	// item description so the customer sees what they paid for.
	const billingEnd = (() => {
		const d = new Date(issueDate);
		switch (product.billingCycle) {
			case 'monthly':
				d.setMonth(d.getMonth() + 1);
				return d;
			case 'quarterly':
				d.setMonth(d.getMonth() + 3);
				return d;
			case 'semiannually':
			case 'biannually':
				d.setMonth(d.getMonth() + 6);
				return d;
			case 'annually':
			case 'yearly':
				d.setFullYear(d.getFullYear() + 1);
				return d;
			case 'triennially':
				d.setFullYear(d.getFullYear() + 3);
				return d;
			case 'one_time':
				return null;
			default:
				return null;
		}
	})();
	const fmtDateRO = (d: Date) =>
		`${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
	const periodLabel = billingEnd ? `(${fmtDateRO(issueDate)} - ${fmtDateRO(billingEnd)})` : '';
	const domainLabel = customerDomain || '(domeniu netransmis)';

	// Line description: clean generic name to enable Keez article caching.
	// If we baked domain+period into the description, every invoice would force
	// a NEW Keez article (since name must be unique in Keez nomenclator), and
	// the PDF would get a `· #OTSH-xxxx` discriminator. With a clean generic
	// name, the FIRST invoice creates one Keez article, and all subsequent
	// invoices reuse it via `hostingProduct.keezItemExternalId`.
	const lineDescription = product.name;

	// Per-line note: domain + period + payment identifier. Pick ONE payment
	// identifier line based on `inquiry.paymentMethod` — not both. Card payments
	// only show "Stripe: pi_xxx"; bank transfers (OP) show "Bank: <reference>".
	// Mixing both was confusing on the printed invoice when only one applied.
	const lineNoteParts: string[] = [];
	if (domainLabel) lineNoteParts.push(domainLabel);
	if (periodLabel) lineNoteParts.push(periodLabel.replace(/[()]/g, '').trim());
	const isBankPath = inquiryPaymentMethod === 'op' || inquiryPaymentMethod === 'bank';
	if (isBankPath) {
		// payment_reference holds whatever admin typed (extras bancar id) or
		// `manual_{inquiryId}` placeholder. Show as-is.
		lineNoteParts.push(`Bank: ${inquiryPaymentReference ?? '-'}`);
	} else if (stripePaymentIntentId) {
		lineNoteParts.push(`Stripe: ${stripePaymentIntentId}`);
	} else if (inquiryPaymentReference) {
		// Unknown method but we have a reference — surface it raw.
		lineNoteParts.push(`Ref: ${inquiryPaymentReference}`);
	}
	const lineNote = lineNoteParts.join(' · ');

	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					await tx.insert(table.invoice).values({
						id: invoiceId,
						tenantId,
						clientId,
						createdByUserId: systemUserId,
						invoiceNumber,
						invoiceSeries: invoiceSeries ?? null,
						status: 'paid',
						amount: netCents,
						taxRate: lineTaxRate, // same as line item
						taxAmount: taxCents,
						totalAmount: totalCents,
						currency: product.currency,
						invoiceCurrency: product.currency,
						issueDate,
						dueDate,
						paidDate: now,
						paymentMethod: 'card',
						stripePaymentIntentId: stripePaymentIntentId ?? null,
						stripeSubscriptionId: stripeSubscriptionId ?? null,
						notes: `Hosting ${product.name} — comandă online (Stripe session ${sessionId})`
					});

					await tx.insert(table.invoiceLineItem).values({
						id: lineItemId,
						invoiceId,
						description: lineDescription,
						note: lineNote,
						quantity: 1,
						rate: netCents,
						amount: netCents,
						taxRate: lineTaxRate,
						currency: product.currency,
						unitOfMeasure: product.billingCycle === 'one_time' ? 'Buc' : 'Lună',
						// Pre-populate from the hostingProduct cache so auto-push
						// reuses the same Keez article (no `· #OTSH-xxxx` suffix
						// drift). First invoice: cache is null → auto-push creates
						// a new article and we save it back below.
						keezItemExternalId: product.keezItemExternalId ?? null
					});
				}),
			{ tenantId, label: 'emit-keez/insertInvoice' }
		);
	} catch (err) {
		const { message } = serializeError(err);
		logError('keez', `emit-keez: invoice INSERT failed: ${message}`, {
			tenantId,
			metadata: { sessionId, invoiceId, productId }
		});
		return { skipped: true, reason: 'invoice_insert_failed' };
	}

	logInfo('keez', `emit-keez: CRM invoice ${invoiceNumber} created (${invoiceId})`, {
		tenantId,
		metadata: {
			invoiceId,
			invoiceNumber,
			netCents,
			taxCents,
			totalCents,
			currency: product.currency,
			sessionId
		}
	});

	// 7. Push to Keez. Errors here DON'T undo the CRM invoice — staff can retry
	// via /invoices/{id} push button. The Keez extId gets cached on success.
	let keezExternalId: string | null = null;
	try {
		const pushResult = await pushInvoiceToKeez(tenantId, invoiceId);
		if (pushResult.success) {
			keezExternalId = pushResult.externalId;
			logInfo('keez', `emit-keez: pushed ${invoiceNumber} to Keez`, {
				tenantId,
				metadata: { invoiceId, keezExternalId }
			});
			// Cache the Keez article externalId on the hostingProduct row so
			// SUBSEQUENT invoices for the same product reuse the article (no
			// `· #OTSH-xxxx` suffix on the PDF). Read the resolved externalId
			// from the line item we just inserted — auto-push wrote it there
			// after createItem succeeded. Only update the cache when empty so
			// we never overwrite a previously cached id with a fresh one.
			if (!product.keezItemExternalId) {
				const [refreshed] = await db
					.select({ keezItemExternalId: table.invoiceLineItem.keezItemExternalId })
					.from(table.invoiceLineItem)
					.where(eq(table.invoiceLineItem.id, lineItemId))
					.limit(1);
				const articleExtId = refreshed?.keezItemExternalId;
				if (articleExtId && /^[a-f0-9]{32}$/i.test(articleExtId)) {
					await db
						.update(table.hostingProduct)
						.set({ keezItemExternalId: articleExtId, updatedAt: new Date() })
						.where(
							and(
								eq(table.hostingProduct.id, productId),
								eq(table.hostingProduct.tenantId, tenantId)
							)
						);
					logInfo('keez', `emit-keez: cached Keez article ${articleExtId} on hostingProduct ${productId}`, {
						tenantId,
						metadata: { productId, articleExternalId: articleExtId }
					});
				}
			}

			// Stripe follow-up: stamp our CRM invoice number on the PaymentIntent
			// so the Stripe Dashboard shows "Factură OTSH 1 — Wordpress Premium"
			// in the Description field (reconciliation: see exactly which CRM
			// invoice a Stripe charge maps to without opening CRM separately).
			// Statement descriptor on the customer's card statement was already
			// finalized at confirm time — that one we can't change retro.
			if (stripePaymentIntentId) {
				try {
					const stripe = await getStripeForTenant(tenantId);
					await stripe.paymentIntents.update(stripePaymentIntentId, {
						description: `Factură ${invoiceNumber} — ${product.name}`,
						metadata: {
							crmTenantId: tenantId,
							crmClientId: clientId,
							crmHostingProductId: productId,
							crmInvoiceId: invoiceId,
							crmInvoiceNumber: invoiceNumber,
							crmInvoiceSeries: invoiceSeries ?? '',
							crmSubscriptionId: stripeSubscriptionId ?? '',
							keezExternalId: keezExternalId ?? ''
						}
					});
					logInfo('keez', `emit-keez: stamped PaymentIntent ${stripePaymentIntentId} with invoice ${invoiceNumber}`, {
						tenantId,
						metadata: { paymentIntentId: stripePaymentIntentId, invoiceNumber }
					});
				} catch (err) {
					const { message } = serializeError(err);
					logError('keez', `emit-keez: PaymentIntent update failed: ${message}`, {
						tenantId,
						metadata: { paymentIntentId: stripePaymentIntentId, invoiceNumber }
					});
					// Non-fatal — the CRM invoice + Keez push already succeeded.
					// Dashboard description stays at the original `Hosting one-time
					// — Wordpress Premium` until staff syncs it manually.
				}
			}

			// Same stamping for Subscriptions — the Stripe Dashboard shows the
			// subscription's metadata + description on every renewal invoice.
			if (stripeSubscriptionId) {
				try {
					const stripe = await getStripeForTenant(tenantId);
					await stripe.subscriptions.update(stripeSubscriptionId, {
						description: `Hosting ${product.name} — factură inițială ${invoiceNumber}`,
						metadata: {
							crmTenantId: tenantId,
							crmClientId: clientId,
							crmHostingProductId: productId,
							crmFirstInvoiceId: invoiceId,
							crmFirstInvoiceNumber: invoiceNumber,
							crmInvoiceSeries: invoiceSeries ?? '',
							keezExternalId: keezExternalId ?? ''
						}
					});
				} catch (err) {
					const { message } = serializeError(err);
					logError('keez', `emit-keez: Subscription update failed: ${message}`, {
						tenantId,
						metadata: { subscriptionId: stripeSubscriptionId, invoiceNumber }
					});
				}
			}
		} else {
			logError('keez', `emit-keez: pushInvoiceToKeez returned !success: ${pushResult.error ?? 'unknown'}`, {
				tenantId,
				metadata: { invoiceId, sessionId }
			});
		}
	} catch (err) {
		const { message } = serializeError(err);
		logError('keez', `emit-keez: pushInvoiceToKeez threw: ${message}`, {
			tenantId,
			metadata: { invoiceId, sessionId }
		});
		// Don't fail the whole step — invoice exists in CRM; staff can re-push.
	}

	// 8. Recurring template — when the product is on a recurring cycle, register a
	// `recurring_invoice` row so the scheduler emits future invoices (renewals)
	// automatically. One-time products skip this step. Stripe handles the
	// payment_intent webhook for each renewal too, but the CRM-side template is
	// what staff use to track upcoming due dates + email reminders.
	if (product.billingCycle !== 'one_time' && stripeSubscriptionId) {
		try {
			await createRecurringTemplate({
				tenantId,
				clientId,
				createdByUserId: systemUserId,
				product,
				netCents,
				lineTaxRate,
				stripeSubscriptionId,
				issueDate
			});
		} catch (err) {
			const { message } = serializeError(err);
			logError('keez', `emit-keez: recurring_invoice INSERT failed: ${message}`, {
				tenantId,
				metadata: { invoiceId, sessionId, subscriptionId: stripeSubscriptionId }
			});
			// Non-fatal: the primary invoice is already emitted; staff can wire
			// the recurring template manually from the order drawer.
		}
	}

	return { invoiceId, keezExternalId, invoiceNumber };
}

/**
 * Translate `hostingProduct.billingCycle` to recurring_invoice (`recurringType`,
 * `recurringInterval`) + compute the first `nextRunDate` based on the cycle
 * starting from the order's issue date.
 */
function cycleToRecurring(cycle: string, issue: Date): { type: string; interval: number; next: Date } {
	const next = new Date(issue);
	switch (cycle) {
		case 'monthly':
			next.setMonth(next.getMonth() + 1);
			return { type: 'monthly', interval: 1, next };
		case 'quarterly':
			next.setMonth(next.getMonth() + 3);
			return { type: 'monthly', interval: 3, next };
		case 'semiannually':
		case 'biannually':
			next.setMonth(next.getMonth() + 6);
			return { type: 'monthly', interval: 6, next };
		case 'annually':
		case 'yearly':
			next.setFullYear(next.getFullYear() + 1);
			return { type: 'yearly', interval: 1, next };
		case 'triennially':
			next.setFullYear(next.getFullYear() + 3);
			return { type: 'yearly', interval: 3, next };
		default:
			// Unknown cycle — schedule 30 days out as a safe fallback.
			next.setDate(next.getDate() + 30);
			return { type: 'monthly', interval: 1, next };
	}
}

async function createRecurringTemplate(params: {
	tenantId: string;
	clientId: string;
	createdByUserId: string;
	product: {
		id: string;
		name: string;
		currency: string;
		billingCycle: string;
	};
	netCents: number;
	lineTaxRate: number;
	stripeSubscriptionId: string;
	issueDate: Date;
}): Promise<void> {
	const { tenantId, clientId, createdByUserId, product, netCents, lineTaxRate, stripeSubscriptionId, issueDate } =
		params;

	// Idempotency — one recurring template per Stripe subscription.
	const [existing] = await db
		.select({ id: table.recurringInvoice.id })
		.from(table.recurringInvoice)
		.where(
			and(
				eq(table.recurringInvoice.tenantId, tenantId),
				eq(table.recurringInvoice.notes, `stripe_subscription:${stripeSubscriptionId}`)
			)
		)
		.limit(1);
	if (existing) {
		logInfo('keez', `recurring_invoice already exists for subscription ${stripeSubscriptionId}, skip`, {
			tenantId,
			metadata: { recurringId: existing.id }
		});
		return;
	}

	const { type, interval, next } = cycleToRecurring(product.billingCycle, issueDate);

	await db.insert(table.recurringInvoice).values({
		id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15))),
		tenantId,
		clientId,
		createdByUserId,
		name: `${product.name} (recurring)`,
		amount: netCents,
		taxRate: lineTaxRate,
		currency: product.currency,
		recurringType: type,
		recurringInterval: interval,
		startDate: issueDate,
		nextRunDate: next,
		// Marker the scheduler can read to know this template comes from a Stripe
		// subscription. The retry job + Keez emit can branch on this if needed.
		// Stored as a structured tag in `notes` to avoid adding a column for v1.
		notes: `stripe_subscription:${stripeSubscriptionId}`,
		// CONTRACT: generateInvoiceFromRecurringTemplate (invoice-utils.ts) treats
		// lineItemsJson `rate` as DECIMAL currency units and `taxRate` as PERCENT
		// (Math.round(rate * 100) / Math.round(taxRate * 100)). Storing cents/bps
		// here caused a 100× over-billing (audit finding C2). The shared helper
		// encodes the unit contract so it can never drift again.
		lineItemsJson: JSON.stringify([
			buildRecurringLineItem({
				description: product.name,
				netCents,
				// lineTaxRate is BPS (vatPercent × 100) → back to integer percent.
				taxRatePercent: Math.round(lineTaxRate / 100),
				currency: product.currency
			})
		]),
		isActive: true
	});

	logInfo('keez', `recurring_invoice template created for subscription ${stripeSubscriptionId}`, {
		tenantId,
		metadata: { clientId, productId: product.id, type, interval, nextRun: next.toISOString() }
	});
}
