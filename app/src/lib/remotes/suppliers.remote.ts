import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getCompanyData } from '$lib/remotes/anaf.remote';

function generateSupplierId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const supplierSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	email: v.optional(v.pipe(v.string(), v.email('Invalid email'))),
	phone: v.optional(v.string()),
	companyType: v.optional(v.string()),
	cui: v.optional(v.string()),
	registrationNumber: v.optional(v.string()),
	tradeRegister: v.optional(v.string()),
	vatNumber: v.optional(v.string()),
	legalRepresentative: v.optional(v.string()),
	iban: v.optional(v.string()),
	bankName: v.optional(v.string()),
	address: v.optional(v.string()),
	city: v.optional(v.string()),
	county: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string()),
	notes: v.optional(v.string())
});

export const getSuppliers = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const suppliers = await db
		.select()
		.from(table.supplier)
		.where(eq(table.supplier.tenantId, event.locals.tenant.id));

	return suppliers;
});

export const getSupplier = query(v.pipe(v.string(), v.minLength(1)), async (supplierId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [supplier] = await db
		.select()
		.from(table.supplier)
		.where(and(eq(table.supplier.id, supplierId), eq(table.supplier.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!supplier) {
		throw new Error('Supplier not found');
	}

	return supplier;
});

export const createSupplier = command(supplierSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const supplierId = generateSupplierId();

	await db.insert(table.supplier).values({
		id: supplierId,
		tenantId: event.locals.tenant.id,
		name: data.name,
		email: data.email || null,
		phone: data.phone || null,
		companyType: data.companyType || null,
		cui: data.cui || null,
		registrationNumber: data.registrationNumber || null,
		tradeRegister: data.tradeRegister || null,
		vatNumber: data.vatNumber || null,
		legalRepresentative: data.legalRepresentative || null,
		iban: data.iban || null,
		bankName: data.bankName || null,
		address: data.address || null,
		city: data.city || null,
		county: data.county || null,
		postalCode: data.postalCode || null,
		country: data.country || 'România',
		notes: data.notes || null
	});

	return { success: true, supplierId };
});

export const updateSupplier = command(
	v.object({
		supplierId: v.pipe(v.string(), v.minLength(1)),
		...supplierSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { supplierId, ...updateData } = data;

		// Verify supplier belongs to tenant
		const [existing] = await db
			.select()
			.from(table.supplier)
			.where(and(eq(table.supplier.id, supplierId), eq(table.supplier.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Supplier not found');
		}

		await db
			.update(table.supplier)
			.set({
				...updateData,
				updatedAt: new Date()
			})
			.where(eq(table.supplier.id, supplierId));

		return { success: true };
	}
);

export const deleteSupplier = command(v.pipe(v.string(), v.minLength(1)), async (supplierId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify supplier belongs to tenant
	const [existing] = await db
		.select()
		.from(table.supplier)
		.where(and(eq(table.supplier.id, supplierId), eq(table.supplier.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Supplier not found');
	}

	await db.delete(table.supplier).where(eq(table.supplier.id, supplierId));

	return { success: true };
});
