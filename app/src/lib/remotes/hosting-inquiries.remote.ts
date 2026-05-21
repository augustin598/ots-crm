import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, ne } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { provisionDirectAdminAccount } from '$lib/server/stripe/post-payment/provision-da';

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

	await db
		.delete(table.hostingInquiry)
		.where(
			and(eq(table.hostingInquiry.id, id), eq(table.hostingInquiry.tenantId, tenantId))
		);

	return { success: true };
});

// ====================== New: full orders view + payment + provisioning ======

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
	clientId: string | null;
	clientName: string | null;
	paymentMethod: string | null;
	paymentStatus: string;
	paidAt: string | null;
	paidAmountCents: number | null;
	paymentReference: string | null;
	acceptedByUserId: string | null;
	acceptedAt: string | null;
	hostingAccountId: string | null;
	daUsername: string | null;
	daDomain: string | null;
	daAccountStatus: string | null;
	stripeCheckoutSessionId: string | null;
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
			clientId: table.hostingInquiry.clientId,
			clientName: table.client.name,
			paymentMethod: table.hostingInquiry.paymentMethod,
			paymentStatus: table.hostingInquiry.paymentStatus,
			paidAt: table.hostingInquiry.paidAt,
			paidAmountCents: table.hostingInquiry.paidAmountCents,
			paymentReference: table.hostingInquiry.paymentReference,
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

	return rows as HostingOrderRow[];
});

const AcceptPaymentSchema = v.object({
	id: IdSchema,
	paymentMethod: v.picklist(['op', 'card', 'paypal', 'revolut', 'other']),
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
			stripeSubscriptionId: null
		});
		await db
			.update(table.hostingInquiry)
			.set({ hostingAccountId: result.hostingAccountId, updatedAt: new Date() })
			.where(
				and(eq(table.hostingInquiry.id, params.id), eq(table.hostingInquiry.tenantId, tenantId))
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
			stripeSubscriptionId: null
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
