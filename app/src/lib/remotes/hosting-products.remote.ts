import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, isNotNull, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const ProductSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(255)),
	// Nullable so callers can clear a previously-set value via { description: null }.
	// `undefined` would be dropped by Drizzle's `.set(...)` and the column wouldn't be updated.
	description: v.optional(v.nullable(v.string())),
	features: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
	highlightBadge: v.optional(v.nullable(v.string())),
	sortOrder: v.optional(v.pipe(v.number(), v.integer()), 0),
	daServerId: v.optional(v.nullable(v.string())),
	daPackageId: v.optional(v.nullable(v.string())),
	price: v.pipe(v.number(), v.integer(), v.minValue(0)),
	currency: v.optional(v.string(), 'RON'),
	billingCycle: v.optional(
		v.picklist(['monthly', 'quarterly', 'annually', 'biannually', 'triennially', 'one_time']),
		'monthly'
	),
	setupFee: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	isActive: v.optional(v.boolean(), true),
	isPublic: v.optional(v.boolean(), false),
	publicSortOrder: v.optional(v.pipe(v.number(), v.integer()), 0)
});

const UpdateSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	data: v.partial(ProductSchema)
});

const IdSchema = v.pipe(v.string(), v.minLength(1));

export const getHostingProducts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	return db
		.select({
			id: table.hostingProduct.id,
			name: table.hostingProduct.name,
			description: table.hostingProduct.description,
			features: table.hostingProduct.features,
			highlightBadge: table.hostingProduct.highlightBadge,
			sortOrder: table.hostingProduct.sortOrder,
			price: table.hostingProduct.price,
			currency: table.hostingProduct.currency,
			billingCycle: table.hostingProduct.billingCycle,
			setupFee: table.hostingProduct.setupFee,
			isActive: table.hostingProduct.isActive,
			isPublic: table.hostingProduct.isPublic,
			publicSortOrder: table.hostingProduct.publicSortOrder,
			daServerId: table.hostingProduct.daServerId,
			daPackageId: table.hostingProduct.daPackageId,
			serverName: table.daServer.name,
			packageName: table.daPackage.daName,
			pkgBandwidth: table.daPackage.bandwidth,
			pkgQuota: table.daPackage.quota,
			pkgMaxEmailAccounts: table.daPackage.maxEmailAccounts,
			pkgMaxDatabases: table.daPackage.maxDatabases,
			pkgMaxFtpAccounts: table.daPackage.maxFtpAccounts,
			pkgMaxDomains: table.daPackage.maxDomains,
			pkgMaxSubdomains: table.daPackage.maxSubdomains,
			pkgIsActive: table.daPackage.isActive,
			createdAt: table.hostingProduct.createdAt
		})
		.from(table.hostingProduct)
		.leftJoin(table.daServer, eq(table.hostingProduct.daServerId, table.daServer.id))
		.leftJoin(table.daPackage, eq(table.hostingProduct.daPackageId, table.daPackage.id))
		.where(eq(table.hostingProduct.tenantId, event.locals.tenant.id))
		.orderBy(table.hostingProduct.sortOrder, desc(table.hostingProduct.createdAt));
});

export const getHostingProduct = query(IdSchema, async (productId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	const [product] = await db
		.select()
		.from(table.hostingProduct)
		.where(
			and(
				eq(table.hostingProduct.id, productId),
				eq(table.hostingProduct.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	if (!product) throw new Error('Product not found');
	return product;
});

/**
 * Verify that the given `daServerId` (and optionally `daPackageId`) belong to
 * the caller's tenant. Throws on cross-tenant references — without this guard,
 * a malicious admin could craft a payload that points at another tenant's
 * server/package and then surface that tenant's metadata (quota, bandwidth,
 * name) via the leftJoin in `getHostingProducts`.
 *
 * `null`/undefined inputs are skipped (the caller is clearing the link).
 */
async function assertDARefsBelongToTenant(
	tenantId: string,
	daServerId: string | null | undefined,
	daPackageId: string | null | undefined
): Promise<void> {
	if (daServerId) {
		const [srv] = await db
			.select({ id: table.daServer.id })
			.from(table.daServer)
			.where(and(eq(table.daServer.id, daServerId), eq(table.daServer.tenantId, tenantId)))
			.limit(1);
		if (!srv) throw new Error('Server DA invalid sau nu aparține acestui tenant.');
	}
	if (daPackageId) {
		const [pkg] = await db
			.select({ id: table.daPackage.id })
			.from(table.daPackage)
			.where(
				and(eq(table.daPackage.id, daPackageId), eq(table.daPackage.tenantId, tenantId))
			)
			.limit(1);
		if (!pkg) throw new Error('Pachet DA invalid sau nu aparține acestui tenant.');
	}
}

export const createHostingProduct = command(ProductSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	await assertDARefsBelongToTenant(event.locals.tenant.id, data.daServerId, data.daPackageId);

	const id = generateId();
	// Explicit field whitelist (Audit LOW-1). `ProductSchema` is strict today, but
	// spreading `data` straight into Drizzle relies on the schema staying strict
	// forever — if someone loosens it to v.looseObject later, this turns into a
	// mass-assignment vulnerability (e.g. attacker injecting `isPublic: true`
	// on a product they shouldn't be able to publish, or worse, `tenantId`).
	await db.insert(table.hostingProduct).values({
		id,
		tenantId: event.locals.tenant.id,
		name: data.name,
		description: data.description ?? null,
		features: data.features ?? null,
		highlightBadge: data.highlightBadge ?? null,
		sortOrder: data.sortOrder,
		daServerId: data.daServerId ?? null,
		daPackageId: data.daPackageId ?? null,
		price: data.price,
		currency: data.currency,
		billingCycle: data.billingCycle,
		setupFee: data.setupFee,
		isActive: data.isActive,
		isPublic: data.isPublic,
		publicSortOrder: data.publicSortOrder
	});

	return { id };
});

export const updateHostingProduct = command(UpdateSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	// Only validate FK targets that the caller is actually trying to set —
	// a partial update that doesn't touch daServerId/daPackageId leaves them as-is.
	await assertDARefsBelongToTenant(
		event.locals.tenant.id,
		params.data.daServerId,
		params.data.daPackageId
	);

	await db
		.update(table.hostingProduct)
		.set({ ...params.data, updatedAt: new Date() })
		.where(
			and(
				eq(table.hostingProduct.id, params.id),
				eq(table.hostingProduct.tenantId, event.locals.tenant.id)
			)
		);

	return { success: true };
});

export const deleteHostingProduct = command(IdSchema, async (productId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	// Soft-delete: keep product but mark inactive
	await db
		.update(table.hostingProduct)
		.set({ isActive: false, updatedAt: new Date() })
		.where(
			and(
				eq(table.hostingProduct.id, productId),
				eq(table.hostingProduct.tenantId, event.locals.tenant.id)
			)
		);

	return { success: true };
});

/**
 * Returns sold-count and MRR (per-month equivalent, in cents) per hosting product.
 * Only counts `active` accounts — pending/cancelled/suspended excluded so the
 * numbers match the "active revenue" framing on the products page.
 *
 * Cycle multipliers (account.recurringAmount is per-cycle, in cents):
 *   monthly      → /1
 *   quarterly    → /3
 *   semiannually → /6   (legacy alias)
 *   biannually   → /6
 *   annually     → /12
 *   biennially   → /24
 *   triennially  → /36
 *   one_time     → excluded (no recurring revenue)
 */
export const getHostingProductStats = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	// Per-row ROUND inside the SUM matches the JS pattern used elsewhere
	// (e.g. hosting accounts MRR does `Math.round(amount / months)` per account
	// then sums). Rounding the SUM instead would yield slightly different totals
	// for many small accounts on non-monthly cycles.
	const rows = await db
		.select({
			productId: table.hostingAccount.hostingProductId,
			sold: sql<number>`COUNT(*)`.as('sold'),
			mrrCents: sql<number>`
				COALESCE(SUM(ROUND(
					CASE ${table.hostingAccount.billingCycle}
						WHEN 'monthly'      THEN ${table.hostingAccount.recurringAmount} * 1.0
						WHEN 'quarterly'    THEN ${table.hostingAccount.recurringAmount} * 1.0 / 3
						WHEN 'semiannually' THEN ${table.hostingAccount.recurringAmount} * 1.0 / 6
						WHEN 'biannually'   THEN ${table.hostingAccount.recurringAmount} * 1.0 / 6
						WHEN 'annually'     THEN ${table.hostingAccount.recurringAmount} * 1.0 / 12
						WHEN 'biennially'   THEN ${table.hostingAccount.recurringAmount} * 1.0 / 24
						WHEN 'triennially'  THEN ${table.hostingAccount.recurringAmount} * 1.0 / 36
						ELSE 0
					END
				)), 0)
			`.as('mrr_cents')
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, event.locals.tenant.id),
				eq(table.hostingAccount.status, 'active'),
				isNotNull(table.hostingAccount.hostingProductId)
			)
		)
		.groupBy(table.hostingAccount.hostingProductId);

	const map: Record<string, { sold: number; mrrCents: number }> = {};
	for (const row of rows) {
		if (!row.productId) continue;
		map[row.productId] = {
			sold: Number(row.sold) || 0,
			mrrCents: Number(row.mrrCents) || 0
		};
	}
	return map;
});
