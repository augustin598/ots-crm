/**
 * Shared insert path for hosting inquiries — used by both:
 *   - public submit (`/pachete-hosting` → submitHostingOrder)
 *   - admin manual creation (`+ Comandă manuală` → createManualHostingOrder)
 *
 * Identical row shape across both paths: same `order_number` subquery
 * (libSQL single-writer + UNIQUE index guard) and the same items insert.
 *
 * Accepting an optional pre-generated `id` and pre-fetched `product` lets
 * existing callers keep their ordering of allocations + lookups without
 * having to refetch the product row twice.
 */
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sql, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Just the fields the helper needs from a hosting_product row. Passing this
 * pre-fetched object lets a caller (e.g. submitHostingOrder) reuse a SELECT
 * it already did rather than triggering a second DB roundtrip inside the
 * helper.
 */
export interface InsertOrderProduct {
	id: string;
	name: string;
	price: number;
	billingCycle: string | null;
}

export interface InsertOrderParams {
	/** Optional pre-generated inquiry id. Defaults to a fresh base32 id. */
	id?: string;
	contactName: string;
	contactEmail: string;
	contactPhone?: string | null;
	companyName?: string | null;
	vatNumber?: string | null;
	message?: string | null;
	hostingProductId?: string | null;
	/** Pre-fetched product row — overrides any lookup driven by hostingProductId. */
	product?: InsertOrderProduct | null;
	clientId?: string | null;
	source?: string;
	ipAddress?: string | null;
	userAgent?: string | null;
	paymentMethod?: 'card' | 'op' | 'paypal' | 'revolut' | 'cash' | null;
	paymentStatus?: 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';
	paidAmountCents?: number | null;
	paidAt?: Date | null;
	paymentReference?: string | null;
	cardLast4?: string | null;
	acceptedByUserId?: string | null;
	acceptedAt?: Date | null;
	requestedDomain?: string | null;
	domainName?: string | null;
	domainMode?: 'buy' | 'have' | 'transfer' | null;
	domainCostCents?: number | null;
	status?: 'new' | 'contacted' | 'converted' | 'discarded' | 'abandoned';
	clientCreated?: boolean;
	clientCreatedAt?: Date | null;
}

/**
 * Insert a hosting inquiry row + (where applicable) the matching line items.
 * Items inserted:
 *  - `hosting` row when a product is in play (one per inquiry)
 *  - `domain` row when domainName is set:
 *      mode='buy' → priced at domainCostCents
 *      mode='have'|'transfer' → unit_price_cents=0 (kept for audit)
 *
 * Returns the inquiry id. Caller wraps in withTursoBusyRetry / transactions as needed.
 */
export async function insertHostingOrder(
	tenantId: string,
	params: InsertOrderParams
): Promise<{ id: string }> {
	const id = params.id ?? generateId();

	// Resolve the product row.
	//
	// `params.product` semantics:
	//   undefined → "lookup by hostingProductId if present" (race-recovery
	//                paths where the caller has only the id)
	//   null      → explicit "do not insert a hosting line item" (used by
	//                the lightweight `submitHostingInquiry` ask-for-quote
	//                form which never has items even when hostingProductId
	//                is set for context)
	//   object    → caller already SELECTed it (most checkout paths)
	let product: InsertOrderProduct | null;
	if (params.product !== undefined) {
		product = params.product;
	} else if (params.hostingProductId) {
		const [row] = await db
			.select({
				id: table.hostingProduct.id,
				name: table.hostingProduct.name,
				price: table.hostingProduct.price,
				billingCycle: table.hostingProduct.billingCycle
			})
			.from(table.hostingProduct)
			.where(eq(table.hostingProduct.id, params.hostingProductId))
			.limit(1);
		product = row ?? null;
	} else {
		product = null;
	}

	const paidAtIso = params.paidAt
		? params.paidAt.toISOString()
		: null;
	const acceptedAtIso = params.acceptedAt
		? params.acceptedAt.toISOString()
		: null;

	await db.insert(table.hostingInquiry).values({
		id,
		tenantId,
		orderNumber: sql`(SELECT COALESCE(MAX(order_number), 0) + 1 FROM hosting_inquiry WHERE tenant_id = ${tenantId})`,
		hostingProductId: params.hostingProductId ?? product?.id ?? null,
		contactName: params.contactName,
		contactEmail: params.contactEmail,
		contactPhone: params.contactPhone ?? null,
		companyName: params.companyName ?? null,
		vatNumber: params.vatNumber ?? null,
		message: params.message ?? null,
		clientId: params.clientId ?? null,
		source: params.source ?? 'pachete-hosting',
		ipAddress: params.ipAddress ?? null,
		userAgent: params.userAgent ?? null,
		paymentMethod: params.paymentMethod ?? null,
		paymentStatus: params.paymentStatus ?? 'pending',
		paidAmountCents: params.paidAmountCents ?? null,
		paidAt: paidAtIso,
		paymentReference: params.paymentReference ?? null,
		cardLast4: params.cardLast4 ?? null,
		acceptedByUserId: params.acceptedByUserId ?? null,
		acceptedAt: acceptedAtIso,
		requestedDomain: params.requestedDomain ?? null,
		status: params.status ?? 'new',
		clientCreated: params.clientCreated ?? false,
		clientCreatedAt: params.clientCreatedAt ?? null
	});

	const items: (typeof table.hostingInquiryItem.$inferInsert)[] = [];
	if (product) {
		const period = product.billingCycle === 'yearly' ? 'anual' : 'lunar';
		items.push({
			id: generateId(),
			inquiryId: id,
			tenantId,
			kind: 'hosting',
			label: `${product.name} (${period})`,
			hostingProductId: product.id,
			unitPriceCents: product.price,
			quantity: 1,
			vatRate: 19
		});
	}

	if (params.domainName) {
		const mode = params.domainMode ?? null;
		if (mode === 'buy' && (params.domainCostCents ?? 0) > 0) {
			items.push({
				id: generateId(),
				inquiryId: id,
				tenantId,
				kind: 'domain',
				label: `Domeniu ${params.domainName}`,
				unitPriceCents: params.domainCostCents!,
				quantity: 1,
				vatRate: 19,
				domainName: params.domainName,
				domainMode: 'buy'
			});
		} else if (mode === 'have' || mode === 'transfer') {
			const lbl = mode === 'have' ? 'existent' : 'transfer';
			items.push({
				id: generateId(),
				inquiryId: id,
				tenantId,
				kind: 'domain',
				label: `Domeniu ${params.domainName} (${lbl})`,
				unitPriceCents: 0,
				quantity: 1,
				vatRate: 19,
				domainName: params.domainName,
				domainMode: mode
			});
		}
	}

	if (items.length) await db.insert(table.hostingInquiryItem).values(items);

	return { id };
}
