import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, ne, isNull, inArray } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { provisionDirectAdminAccount } from '$lib/server/stripe/post-payment/provision-da';
import { createHostingAccountInternal } from '$lib/server/hosting/create-account';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { insertHostingOrder } from '$lib/server/hosting/insert-order';

/**
 * Admin-side management of hosting inquiries / orders submitted via the public
 * /pachete-hosting marketing page.
 *
 * Funnel status (`status`) is the staff workflow state (new → contacted → converted
 * → discarded/abandoned). Payment status (`paymentStatus`) is independent: an OP
 * order can sit at status='new' + paymentStatus='pending' until staff confirms
 * the bank transfer landed.
 */

function tenantScope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { event, tenantId: event.locals.tenant.id };
}

const IdSchema = v.pipe(v.string(), v.minLength(1));

// ====================== Legacy queries (still used by the inquiries page) ===

export const getHostingInquiries = query(async () => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	return db
		.select({
			id: table.hostingInquiry.id,
			hostingProductId: table.hostingInquiry.hostingProductId,
			contactName: table.hostingInquiry.contactName,
			contactEmail: table.hostingInquiry.contactEmail,
			contactPhone: table.hostingInquiry.contactPhone,
			companyName: table.hostingInquiry.companyName,
			vatNumber: table.hostingInquiry.vatNumber,
			message: table.hostingInquiry.message,
			status: table.hostingInquiry.status,
			source: table.hostingInquiry.source,
			ipAddress: table.hostingInquiry.ipAddress,
			createdAt: table.hostingInquiry.createdAt,
			contactedAt: table.hostingInquiry.contactedAt,
			productName: table.hostingProduct.name
		})
		.from(table.hostingInquiry)
		.leftJoin(
			table.hostingProduct,
			eq(table.hostingInquiry.hostingProductId, table.hostingProduct.id)
		)
		.where(eq(table.hostingInquiry.tenantId, tenantId))
		.orderBy(desc(table.hostingInquiry.createdAt));
});

const UpdateStatusSchema = v.object({
	id: IdSchema,
	status: v.picklist(['new', 'contacted', 'converted', 'discarded'])
});

export const updateHostingInquiryStatus = command(UpdateStatusSchema, async (params) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const updates: Record<string, unknown> = {
		status: params.status,
		updatedAt: new Date()
	};
	if (params.status === 'contacted') {
		updates.contactedAt = new Date();
	}

	await db
		.update(table.hostingInquiry)
		.set(updates)
		.where(
			and(
				eq(table.hostingInquiry.id, params.id),
				eq(table.hostingInquiry.tenantId, tenantId)
			)
		);

	return { success: true };
});

export const deleteHostingInquiry = command(IdSchema, async (id) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	// Safety guard: refuse delete if the inquiry has been converted to a hosting
	// account. The inquiry IS the conversion-history record for that account —
	// admins must use the cancel/archive path instead (or delete the account
	// first if it's truly defunct).
	const [inquiry] = await db
		.select({ hostingAccountId: table.hostingInquiry.hostingAccountId })
		.from(table.hostingInquiry)
		.where(
			and(eq(table.hostingInquiry.id, id), eq(table.hostingInquiry.tenantId, tenantId))
		)
		.limit(1);

	if (!inquiry) {
		throw error(404, 'Inquiry-ul nu a fost găsit.');
	}

	if (inquiry.hostingAccountId !== null) {
		throw error(
			409,
			'Nu poți șterge un inquiry care a fost convertit într-un cont de hosting. Șterge mai întâi contul de hosting.'
		);
	}

	await db
		.delete(table.hostingInquiry)
		.where(
			and(eq(table.hostingInquiry.id, id), eq(table.hostingInquiry.tenantId, tenantId))
		);

	return { success: true };
});

// ====================== New: full orders view + payment + provisioning ======

export type HostingOrderItemRow = {
	id: string;
	kind: string;
	label: string;
	unitPriceCents: number;
	quantity: number;
	vatRate: number;
	domainName: string | null;
	domainMode: string | null;
};

export type HostingOrderRow = {
	id: string;
	hostingProductId: string | null;
	contactName: string;
	contactEmail: string;
	contactPhone: string | null;
	companyName: string | null;
	vatNumber: string | null;
	message: string | null;
	status: string;
	source: string;
	ipAddress: string | null;
	createdAt: Date;
	contactedAt: Date | null;
	productName: string | null;
	productPrice: number | null;
	productCurrency: string | null;
	productBillingCycle: string | null;
	productDaServerId: string | null;
	productDaPackageId: string | null;
	/** Plan-themed hex color from hosting_product.color. Used in the admin
	 * Comenzi hosting drawer header + KPI tiles for plan-themed accents. */
	productColor: string | null;
	clientId: string | null;
	clientName: string | null;
	clientBusinessName: string | null;
	requestedDomain: string | null;
	paymentMethod: string | null;
	paymentStatus: string;
	paidAt: string | null;
	paidAmountCents: number | null;
	paymentReference: string | null;
	/** Stripe last 4 digits of the card used. Populated by the
	 * payment_intent.succeeded webhook handler from latest_charge. */
	cardLast4: string | null;
	/** Stripe decline_code / error code from payment_intent.payment_failed. */
	paymentErrorCode: string | null;
	/** Romanian-translated error message (via translateDeclineCode). */
	paymentErrorMessage: string | null;
	acceptedByUserId: string | null;
	acceptedAt: string | null;
	hostingAccountId: string | null;
	daUsername: string | null;
	daDomain: string | null;
	daAccountStatus: string | null;
	stripeCheckoutSessionId: string | null;
	orderNumber: number | null;
	items: HostingOrderItemRow[];
};

/**
 * Listă comenzi hosting + tot ce avem despre plata și provisioning-ul lor.
 * Pagina Comenzi hosting consumă această query.
 */
export const getHostingOrders = query(async (): Promise<HostingOrderRow[]> => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const rows = await db
		.select({
			id: table.hostingInquiry.id,
			orderNumber: table.hostingInquiry.orderNumber,
			hostingProductId: table.hostingInquiry.hostingProductId,
			contactName: table.hostingInquiry.contactName,
			contactEmail: table.hostingInquiry.contactEmail,
			contactPhone: table.hostingInquiry.contactPhone,
			companyName: table.hostingInquiry.companyName,
			vatNumber: table.hostingInquiry.vatNumber,
			message: table.hostingInquiry.message,
			status: table.hostingInquiry.status,
			source: table.hostingInquiry.source,
			ipAddress: table.hostingInquiry.ipAddress,
			createdAt: table.hostingInquiry.createdAt,
			contactedAt: table.hostingInquiry.contactedAt,
			productName: table.hostingProduct.name,
			productPrice: table.hostingProduct.price,
			productCurrency: table.hostingProduct.currency,
			productBillingCycle: table.hostingProduct.billingCycle,
			productDaServerId: table.hostingProduct.daServerId,
			productDaPackageId: table.hostingProduct.daPackageId,
			productColor: table.hostingProduct.color,
			clientId: table.hostingInquiry.clientId,
			clientName: table.client.name,
			clientBusinessName: table.client.businessName,
			requestedDomain: table.hostingInquiry.requestedDomain,
			paymentMethod: table.hostingInquiry.paymentMethod,
			paymentStatus: table.hostingInquiry.paymentStatus,
			paidAt: table.hostingInquiry.paidAt,
			paidAmountCents: table.hostingInquiry.paidAmountCents,
			paymentReference: table.hostingInquiry.paymentReference,
			cardLast4: table.hostingInquiry.cardLast4,
			paymentErrorCode: table.hostingInquiry.paymentErrorCode,
			paymentErrorMessage: table.hostingInquiry.paymentErrorMessage,
			acceptedByUserId: table.hostingInquiry.acceptedByUserId,
			acceptedAt: table.hostingInquiry.acceptedAt,
			hostingAccountId: table.hostingInquiry.hostingAccountId,
			daUsername: table.hostingAccount.daUsername,
			daDomain: table.hostingAccount.domain,
			daAccountStatus: table.hostingAccount.status,
			stripeCheckoutSessionId: table.hostingInquiry.stripeCheckoutSessionId
		})
		.from(table.hostingInquiry)
		.leftJoin(
			table.hostingProduct,
			and(
				eq(table.hostingInquiry.hostingProductId, table.hostingProduct.id),
				eq(table.hostingProduct.tenantId, tenantId)
			)
		)
		.leftJoin(
			table.client,
			and(
				eq(table.hostingInquiry.clientId, table.client.id),
				eq(table.client.tenantId, tenantId)
			)
		)
		.leftJoin(
			table.hostingAccount,
			and(
				eq(table.hostingInquiry.hostingAccountId, table.hostingAccount.id),
				eq(table.hostingAccount.tenantId, tenantId)
			)
		)
		.where(eq(table.hostingInquiry.tenantId, tenantId))
		.orderBy(desc(table.hostingInquiry.createdAt));

	if (rows.length === 0) return [];

	const inquiryIds = rows.map((r) => r.id);
	const itemRows = await db
		.select({
			id: table.hostingInquiryItem.id,
			inquiryId: table.hostingInquiryItem.inquiryId,
			kind: table.hostingInquiryItem.kind,
			label: table.hostingInquiryItem.label,
			unitPriceCents: table.hostingInquiryItem.unitPriceCents,
			quantity: table.hostingInquiryItem.quantity,
			vatRate: table.hostingInquiryItem.vatRate,
			domainName: table.hostingInquiryItem.domainName,
			domainMode: table.hostingInquiryItem.domainMode
		})
		.from(table.hostingInquiryItem)
		.where(
			and(
				eq(table.hostingInquiryItem.tenantId, tenantId),
				inArray(table.hostingInquiryItem.inquiryId, inquiryIds)
			)
		);

	const byInquiry = new Map<string, HostingOrderItemRow[]>();
	for (const it of itemRows) {
		const arr = byInquiry.get(it.inquiryId) ?? [];
		arr.push({
			id: it.id,
			kind: it.kind,
			label: it.label,
			unitPriceCents: it.unitPriceCents,
			quantity: it.quantity,
			vatRate: it.vatRate,
			domainName: it.domainName,
			domainMode: it.domainMode
		});
		byInquiry.set(it.inquiryId, arr);
	}

	return rows.map((r) => ({ ...r, items: byInquiry.get(r.id) ?? [] })) as HostingOrderRow[];
});

const AcceptPaymentSchema = v.object({
	id: IdSchema,
	paymentMethod: v.picklist(['op', 'card', 'paypal', 'revolut', 'cash', 'other']),
	paidAmountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
	// Allowlist for bank-transfer references — keeps audit logs readable and
	// prevents accidental binary/control-char paste from extras CSV.
	paymentReference: v.optional(
		v.pipe(
			v.string(),
			v.maxLength(200),
			v.regex(/^[A-Za-z0-9\-_./()\s]*$/, 'Referința conține caractere invalide.')
		)
	),
	note: v.optional(v.pipe(v.string(), v.maxLength(500))),
	triggerProvisioning: v.optional(v.boolean(), true)
});

/**
 * Acceptă manual plata unei comenzi (uzual OP/bank transfer). Marchează inquiry-ul
 * ca paid, activează clientul, opțional declanșează provisioning DirectAdmin.
 *
 * Idempotent: o a doua apelare cu același (id, paymentMethod) nu mai schimbă
 * `paymentStatus` dacă e deja 'paid', dar permite re-triggering DA via parametru.
 */
export const acceptHostingOrderPayment = command(AcceptPaymentSchema, async (params) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');
	const userId = event.locals.user!.id;

	const { order, alreadyPaid } = await db.transaction(async (tx) => {
		const [o] = await tx
			.select({
				id: table.hostingInquiry.id,
				tenantId: table.hostingInquiry.tenantId,
				clientId: table.hostingInquiry.clientId,
				hostingProductId: table.hostingInquiry.hostingProductId,
				paymentStatus: table.hostingInquiry.paymentStatus,
				hostingAccountId: table.hostingInquiry.hostingAccountId,
				currentMessage: table.hostingInquiry.message,
				contactName: table.hostingInquiry.contactName
			})
			.from(table.hostingInquiry)
			.where(
				and(eq(table.hostingInquiry.id, params.id), eq(table.hostingInquiry.tenantId, tenantId))
			)
			.limit(1);
		if (!o) throw error(404, 'Comanda nu există.');
		if (!o.clientId)
			throw error(
				400,
				'Comanda nu are client asociat (probabil un lead vechi). Asignează clientul mai întâi.'
			);
		if (!o.hostingProductId) throw error(400, 'Comanda nu are produs hosting asociat.');

		if (o.paymentStatus === 'paid') {
			return { order: o, alreadyPaid: true };
		}

		const now = new Date();
		const acceptanceNote = params.note?.trim() || null;
		const newMessage = acceptanceNote
			? `${o.currentMessage ? o.currentMessage + '\n' : ''}[Plată acceptată ${now.toISOString()} de ${userId}] ${acceptanceNote}`
			: o.currentMessage;

		// 1. Update inquiry — paymentStatus paid + funnel converted. The
		// `ne(paymentStatus, 'paid')` guard makes the UPDATE a no-op for the
		// second concurrent admin: even if both transactions saw the row as
		// 'pending' in their SELECT, only one UPDATE flips the row; the other
		// matches 0 rows and falls through to the idempotent provisioning step
		// (which short-circuits via hostingAccount lookup).
		await tx
			.update(table.hostingInquiry)
			.set({
				paymentStatus: 'paid',
				paymentMethod: params.paymentMethod,
				paidAt: now.toISOString(),
				paidAmountCents: params.paidAmountCents,
				paymentReference: params.paymentReference?.trim() || `manual_${params.id}`,
				acceptedByUserId: userId,
				acceptedAt: now.toISOString(),
				status: 'converted',
				contactedAt: now,
				updatedAt: now,
				message: newMessage
			})
			.where(
				and(
					eq(table.hostingInquiry.id, params.id),
					eq(table.hostingInquiry.tenantId, tenantId),
					ne(table.hostingInquiry.paymentStatus, 'paid')
				)
			);

		// 2. Activate client (mirror Stripe path).
		await tx
			.update(table.client)
			.set({ status: 'active', onboardingStatus: 'active', updatedAt: now })
			.where(and(eq(table.client.id, o.clientId), eq(table.client.tenantId, tenantId)));

		return { order: { ...o, paymentStatus: 'paid' }, alreadyPaid: false };
	});

	if (!alreadyPaid) {
		logInfo('directadmin', 'hosting order payment accepted manually', {
			tenantId,
			metadata: {
				inquiryId: params.id,
				clientId: order.clientId,
				method: params.paymentMethod,
				amountCents: params.paidAmountCents,
				acceptedBy: userId
			}
		});

		// Cash payments don't trigger a Keez fiscal invoice. The cash receipt
		// (chitanță numerar / bon fiscal de casă) is the legal justifying document
		// and is issued offline at the moment of cash handover — emitting a
		// duplicate Keez invoice on top would create a double-accounting risk.
		// (Stripe-paid orders go through this same function only via the
		// post-payment dispatcher, not through here.)
		const skipFiscalInvoice = params.paymentMethod === 'cash';

		// Emit the fiscal Keez invoice for this manual acceptance, mirroring the
		// Stripe payment_intent.succeeded post-payment dispatcher. Without this,
		// OP / bank-transfer orders would never get a Keez fiscal invoice — staff
		// would have to create one manually. The emit-keez step is idempotent
		// per (sessionId), so a retry on the same inquiry won't double-bill.
		if (skipFiscalInvoice) {
			logInfo(
				'directadmin',
				'manual accept: cash payment — Keez fiscal invoice skipped (offline cash receipt is the legal document)',
				{ tenantId, metadata: { inquiryId: params.id } }
			);
		} else try {
			const { emitKeezFiscalInvoice } = await import(
				'$lib/server/stripe/post-payment/emit-keez-invoice'
			);
			const result = await emitKeezFiscalInvoice({
				tenantId,
				clientId: order.clientId!,
				sessionId: `manual_${params.id}`,
				inquiryId: params.id,
				stripePaymentIntentId: null, // OP path — no Stripe PI
				stripeSubscriptionId: null,
				productId: order.hostingProductId!
			});
			if ('invoiceId' in result) {
				logInfo('directadmin', `manual accept: Keez invoice ${result.invoiceNumber} emitted`, {
					tenantId,
					metadata: { inquiryId: params.id, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber }
				});
			} else {
				logInfo('directadmin', `manual accept: Keez emit skipped (${result.reason})`, {
					tenantId,
					metadata: { inquiryId: params.id, reason: result.reason }
				});
			}
		} catch (err) {
			const { message } = serializeError(err);
			logError('directadmin', `manual accept: Keez emit threw: ${message}`, {
				tenantId,
				metadata: { inquiryId: params.id }
			});
			// Non-fatal — the payment is already marked paid; staff can re-emit
			// from the invoice page if needed.
		}
	}

	// 3. Optionally provision DA. The provision helper is idempotent (checks
	//    hostingAccount by tenant+client+product+subscription), so calling it
	//    twice is safe — second call returns { created: false } with existing account.
	if (!params.triggerProvisioning) {
		return { paymentAccepted: true, provisioned: false as const, reason: 'skipped_by_caller' };
	}

	if (order.hostingAccountId) {
		return {
			paymentAccepted: true,
			provisioned: true as const,
			hostingAccountId: order.hostingAccountId,
			created: false as const
		};
	}

	try {
		const result = await provisionDirectAdminAccount({
			tenantId,
			clientId: order.clientId!,
			productId: order.hostingProductId!,
			sessionId: `manual_${params.id}`,
			stripeSubscriptionId: null,
			inquiryId: params.id
		});
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hostingInquiry)
					.set({ hostingAccountId: result.hostingAccountId, updatedAt: new Date() })
					.where(
						and(
							eq(table.hostingInquiry.id, params.id),
							eq(table.hostingInquiry.tenantId, tenantId)
						)
					),
			{ tenantId, label: 'hosting-inquiries/linkAfterAccept' }
		);
		return {
			paymentAccepted: true,
			provisioned: true as const,
			hostingAccountId: result.hostingAccountId,
			daUsername: result.daUsername,
			domain: result.domain,
			created: result.created
		};
	} catch (err) {
		const { message } = serializeError(err);
		logError('directadmin', `manual provisioning failed for ${params.id}: ${message}`, {
			tenantId,
			metadata: { inquiryId: params.id, clientId: order.clientId }
		});
		return {
			paymentAccepted: true,
			provisioned: false as const,
			reason: message
		};
	}
});

/**
 * Re-rulează provisioning DirectAdmin pentru o comandă deja plătită. Pentru
 * recovery după un fail în webhook flow, sau pentru orders manual-accepted
 * care încă n-au DA account legat.
 */
export const retryDaProvisioning = command(IdSchema, async (id) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const [order] = await db
		.select({
			id: table.hostingInquiry.id,
			clientId: table.hostingInquiry.clientId,
			hostingProductId: table.hostingInquiry.hostingProductId,
			paymentStatus: table.hostingInquiry.paymentStatus,
			paymentReference: table.hostingInquiry.paymentReference,
			hostingAccountId: table.hostingInquiry.hostingAccountId
		})
		.from(table.hostingInquiry)
		.where(
			and(eq(table.hostingInquiry.id, id), eq(table.hostingInquiry.tenantId, tenantId))
		)
		.limit(1);
	if (!order) throw error(404, 'Comanda nu există.');
	if (!order.clientId) throw error(400, 'Lipsește clientul asociat.');
	if (!order.hostingProductId) throw error(400, 'Lipsește produsul hosting.');
	if (order.paymentStatus !== 'paid')
		throw error(400, 'Comanda nu e marcată ca plătită. Acceptă întâi plata.');

	try {
		const result = await provisionDirectAdminAccount({
			tenantId,
			clientId: order.clientId,
			productId: order.hostingProductId,
			sessionId: order.paymentReference ?? `manual_${id}`,
			stripeSubscriptionId: null,
			inquiryId: id
		});
		await db
			.update(table.hostingInquiry)
			.set({ hostingAccountId: result.hostingAccountId, updatedAt: new Date() })
			.where(and(eq(table.hostingInquiry.id, id), eq(table.hostingInquiry.tenantId, tenantId)));
		logInfo('directadmin', `manual retry provisioning OK for ${id}`, {
			tenantId,
			metadata: {
				inquiryId: id,
				hostingAccountId: result.hostingAccountId,
				created: result.created
			}
		});
		return {
			ok: true as const,
			hostingAccountId: result.hostingAccountId,
			daUsername: result.daUsername,
			domain: result.domain,
			created: result.created
		};
	} catch (err) {
		const { message } = serializeError(err);
		logError('directadmin', `retry provisioning failed for ${id}: ${message}`, {
			tenantId,
			metadata: { inquiryId: id, clientId: order.clientId }
		});
		return { ok: false as const, error: message };
	}
});

// ====================== Manual form-driven provisioning =====================
//
// Replaces the auto-gen retryDaProvisioning for staff-driven cases. Admin types
// the actual domain + username + password in the drawer form, and we call the
// shared `createHostingAccountInternal` helper (same path used by
// `/hosting/accounts/new`).

const ProvisionFromInquirySchema = v.object({
	inquiryId: IdSchema,
	daServerId: v.pipe(v.string(), v.minLength(1)),
	daPackageId: v.optional(v.pipe(v.string(), v.minLength(1))),
	daUsername: v.pipe(
		v.string(),
		v.minLength(2, 'Username prea scurt'),
		v.maxLength(16, 'Username max 16 caractere'),
		v.regex(/^[a-z][a-z0-9]*$/, 'Doar litere mici + cifre, primul caracter literă')
	),
	domain: v.pipe(
		v.string(),
		v.minLength(4),
		v.maxLength(253),
		v.regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i, 'Domeniu invalid')
	),
	password: v.pipe(v.string(), v.minLength(8, 'Parola min 8 caractere'), v.maxLength(64)),
	notes: v.optional(v.pipe(v.string(), v.maxLength(500)))
});

export const provisionFromInquiry = command(ProvisionFromInquirySchema, async (params) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const [order] = await db
		.select({
			id: table.hostingInquiry.id,
			clientId: table.hostingInquiry.clientId,
			hostingProductId: table.hostingInquiry.hostingProductId,
			paymentStatus: table.hostingInquiry.paymentStatus,
			hostingAccountId: table.hostingInquiry.hostingAccountId
		})
		.from(table.hostingInquiry)
		.where(
			and(
				eq(table.hostingInquiry.id, params.inquiryId),
				eq(table.hostingInquiry.tenantId, tenantId)
			)
		)
		.limit(1);
	if (!order) throw error(404, 'Comanda nu există.');
	if (!order.clientId) throw error(400, 'Comanda nu are client asociat.');
	if (!order.hostingProductId) throw error(400, 'Comanda nu are produs hosting asociat.');
	if (order.paymentStatus !== 'paid')
		throw error(400, 'Acceptă plata înainte de a rula provisioning.');
	if (order.hostingAccountId)
		throw error(409, 'Comanda are deja un cont DirectAdmin asociat.');

	// Read product defaults for the new hostingAccount (recurring amount + cycle).
	const [product] = await db
		.select({
			price: table.hostingProduct.price,
			currency: table.hostingProduct.currency,
			billingCycle: table.hostingProduct.billingCycle
		})
		.from(table.hostingProduct)
		.where(
			and(
				eq(table.hostingProduct.id, order.hostingProductId),
				eq(table.hostingProduct.tenantId, tenantId)
			)
		)
		.limit(1);

	let result: { id: string; daUsername: string; domain: string };
	try {
		result = await createHostingAccountInternal(tenantId, {
			clientId: order.clientId,
			daServerId: params.daServerId,
			daPackageId: params.daPackageId,
			hostingProductId: order.hostingProductId,
			daUsername: params.daUsername,
			domain: params.domain.toLowerCase(),
			password: params.password,
			recurringAmount: product ? Math.round(Number(product.price) * 100) : 0,
			currency: product?.currency ?? 'RON',
			billingCycle: product?.billingCycle ?? 'monthly',
			notes: params.notes,
			auditTrigger: 'manual'
		});
	} catch (err) {
		const { message } = serializeError(err);
		logError('directadmin', `provisionFromInquiry failed for ${params.inquiryId}: ${message}`, {
			tenantId,
			metadata: { inquiryId: params.inquiryId, daUsername: params.daUsername }
		});
		return { ok: false as const, error: message };
	}

	// Link inquiry → hosting_account. Guarded by `IS NULL` so a concurrent click
	// from another admin's session can't double-link (the DA-side `withAccountLock`
	// already serialized the create itself, but the inquiry UPDATE can still race).
	// Wrapped in withTursoBusyRetry: the DA account already exists in CRM at this
	// point — a transient Turso BUSY here would leave the account unlinked and
	// admins would re-attempt provisioning thinking it failed.
	const linked = await withTursoBusyRetry(
		() =>
			db
				.update(table.hostingInquiry)
				.set({ hostingAccountId: result.id, updatedAt: new Date() })
				.where(
					and(
						eq(table.hostingInquiry.id, params.inquiryId),
						eq(table.hostingInquiry.tenantId, tenantId),
						isNull(table.hostingInquiry.hostingAccountId)
					)
				)
				.returning({ id: table.hostingInquiry.id }),
		{ tenantId, label: 'hosting-inquiries/linkAfterProvision' }
	);

	if (linked.length === 0) {
		// Race lost: a concurrent path (Stripe webhook or another admin) already
		// linked the inquiry to a different hosting_account. Roll back the orphan
		// we just created so it doesn't sit unreferenced in CRM forever. The
		// DA-side account is left in place — staff can delete it via /hosting/accounts
		// once they reconcile which copy to keep.
		await db
			.delete(table.hostingAccount)
			.where(
				and(eq(table.hostingAccount.id, result.id), eq(table.hostingAccount.tenantId, tenantId))
			);
		const [existing] = await db
			.select({
				id: table.hostingAccount.id,
				daUsername: table.hostingAccount.daUsername,
				domain: table.hostingAccount.domain
			})
			.from(table.hostingAccount)
			.innerJoin(
				table.hostingInquiry,
				eq(table.hostingAccount.id, table.hostingInquiry.hostingAccountId)
			)
			.where(
				and(
					eq(table.hostingInquiry.id, params.inquiryId),
					eq(table.hostingInquiry.tenantId, tenantId)
				)
			)
			.limit(1);
		logError(
			'directadmin',
			`provisionFromInquiry race: inquiry ${params.inquiryId} was linked elsewhere, orphan ${result.id} (DA user ${result.daUsername}) deleted from CRM`,
			{
				tenantId,
				metadata: {
					inquiryId: params.inquiryId,
					orphanHostingAccountId: result.id,
					orphanDaUsername: result.daUsername,
					winnerHostingAccountId: existing?.id ?? null
				}
			}
		);
		return {
			ok: false as const,
			error: existing
				? `Comanda a fost provisionată în paralel cu un alt cont (DA user: ${existing.daUsername}). Contul "${result.daUsername}" tocmai creat e orfan în DA — șterge-l manual din panou.`
				: 'Comanda a fost legată la alt cont între timp. Reîncarcă pagina.'
		};
	}

	logInfo('directadmin', `provisionFromInquiry OK for ${params.inquiryId}`, {
		tenantId,
		metadata: {
			inquiryId: params.inquiryId,
			hostingAccountId: result.id,
			daUsername: result.daUsername,
			domain: result.domain
		}
	});

	return {
		ok: true as const,
		hostingAccountId: result.id,
		daUsername: result.daUsername,
		domain: result.domain
	};
});

// ====================== Manual order creation (admin-only) ==================

const ManualOrderSchema = v.object({
	contactName: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	contactEmail: v.pipe(v.string(), v.email()),
	type: v.picklist(['person', 'company']),
	companyName: v.optional(v.pipe(v.string(), v.maxLength(200))),
	vatNumber: v.optional(v.pipe(v.string(), v.maxLength(40))),
	hostingProductId: v.pipe(v.string(), v.minLength(1)),
	period: v.picklist(['monthly', 'yearly']),
	domainName: v.pipe(v.string(), v.minLength(1), v.maxLength(253)),
	domainMode: v.picklist(['buy', 'have', 'transfer']),
	paymentMethod: v.picklist(['card', 'op', 'revolut', 'paypal', 'cash']),
	initialStatus: v.picklist(['paid', 'pending', 'processing']),
	// 'auto' lets the server pick the cheapest available DA server (matches the
	// existing post-payment provisioning policy); a specific DA server id pins
	// the account to that server.
	server: v.optional(v.pipe(v.string(), v.maxLength(60)))
});

/**
 * Admin-only "+ Comandă manuală" command — creates a hosting_inquiry row
 * with the same shape as a public submit, but marked source='manual' and
 * with paymentStatus / status / acceptedAt set per the admin's choice.
 *
 * Uses the same `insertHostingOrder` helper as the public path, so the
 * row + items + order_number subquery semantics stay in lock-step.
 */
export const createManualHostingOrder = command(
	ManualOrderSchema,
	async (data): Promise<{ id: string; orderNumber: number | null }> => {
		const { event, tenantId } = tenantScope();
		const actor = await getActor(event);
		assertCan(actor, 'admin.hosting.manage');

		// Look up product to derive amount + currency. hosting_product has a
		// single `price` column (no separate monthly/yearly); the chosen `period`
		// is informational for the line label only.
		const [product] = await db
			.select({
				id: table.hostingProduct.id,
				name: table.hostingProduct.name,
				price: table.hostingProduct.price,
				billingCycle: table.hostingProduct.billingCycle,
				currency: table.hostingProduct.currency
			})
			.from(table.hostingProduct)
			.where(
				and(
					eq(table.hostingProduct.id, data.hostingProductId),
					eq(table.hostingProduct.tenantId, tenantId)
				)
			)
			.limit(1);
		if (!product) throw error(404, 'Pachet hosting inexistent');

		// Domain cost — defaults to 49 RON for 'buy' (matches the existing public
		// form's flat-rate stub). Future iteration: per-TLD pricing from a
		// domain_tld_price table. 'have'/'transfer' carry no cost.
		const domainCostCents = data.domainMode === 'buy' ? 4900 : 0;
		const paymentStatus = data.initialStatus;
		const paid = paymentStatus === 'paid';
		const grossCents = product.price + domainCostCents;
		const paidAmountCents = paid
			? grossCents + Math.round(grossCents * 0.19)
			: null;

		// For the items insert: the helper builds the hosting line from the
		// product object and computes the period suffix from billingCycle. We
		// override billingCycle to match the admin's selected `period` so the
		// label reads correctly even if the product is configured monthly but
		// the manual order is yearly (or vice-versa).
		const productForItem = {
			id: product.id,
			name: product.name,
			price: product.price,
			billingCycle: data.period === 'yearly' ? 'yearly' : 'monthly'
		};

		const now = new Date();
		const { id } = await insertHostingOrder(tenantId, {
			contactName: data.contactName,
			contactEmail: data.contactEmail,
			companyName: data.type === 'company' ? data.companyName ?? null : null,
			vatNumber: data.type === 'company' ? data.vatNumber ?? null : null,
			hostingProductId: data.hostingProductId,
			product: productForItem,
			source: 'manual',
			paymentMethod: data.paymentMethod,
			paymentStatus,
			paidAmountCents,
			paidAt: paid ? now : null,
			acceptedByUserId: paid && actor.kind === 'tenant' ? actor.userId : null,
			acceptedAt: paid ? now : null,
			requestedDomain: data.domainName,
			domainName: data.domainName,
			domainMode: data.domainMode,
			domainCostCents,
			status: paid ? 'converted' : 'new'
		});

		const [row] = await db
			.select({ orderNumber: table.hostingInquiry.orderNumber })
			.from(table.hostingInquiry)
			.where(eq(table.hostingInquiry.id, id))
			.limit(1);

		logInfo('directadmin', 'manual hosting order created', {
			tenantId,
			metadata: {
				inquiryId: id,
				orderNumber: row?.orderNumber ?? null,
				hostingProductId: data.hostingProductId,
				paymentMethod: data.paymentMethod,
				initialStatus: data.initialStatus,
				createdBy: actor.kind === 'tenant' ? actor.userId : null
			}
		});

		return { id, orderNumber: row?.orderNumber ?? null };
	}
);
