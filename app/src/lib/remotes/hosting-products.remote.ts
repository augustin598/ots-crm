import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const ProductSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(255)),
	description: v.optional(v.string()),
	features: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
	highlightBadge: v.optional(v.string()),
	sortOrder: v.optional(v.pipe(v.number(), v.integer()), 0),
	daServerId: v.optional(v.string()),
	daPackageId: v.optional(v.string()),
	price: v.pipe(v.number(), v.integer(), v.minValue(0)),
	currency: v.optional(v.string(), 'RON'),
	billingCycle: v.optional(
		v.picklist(['monthly', 'quarterly', 'annually', 'biannually', 'triennially', 'one_time']),
		'monthly'
	),
	setupFee: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	isActive: v.optional(v.boolean(), true)
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

export const createHostingProduct = command(ProductSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const id = generateId();
	await db.insert(table.hostingProduct).values({
		id,
		tenantId: event.locals.tenant.id,
		...data
	});

	return { id };
});

export const updateHostingProduct = command(UpdateSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

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
