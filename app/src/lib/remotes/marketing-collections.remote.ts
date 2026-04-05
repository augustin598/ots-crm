import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

// ==================== QUERIES ====================

export const getMarketingCollections = query(
	v.object({
		clientId: v.optional(v.string()),
		clientIds: v.optional(v.array(v.string()))
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.marketingCollection.tenantId, event.locals.tenant.id);

		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(
				conditions,
				eq(table.marketingCollection.clientId, event.locals.client.id)
			) as typeof conditions;
		} else if (filters.clientId) {
			conditions = and(conditions, eq(table.marketingCollection.clientId, filters.clientId)) as typeof conditions;
		} else if (filters.clientIds && filters.clientIds.length > 0) {
			conditions = and(conditions, inArray(table.marketingCollection.clientId, filters.clientIds)) as typeof conditions;
		}

		const collections = await db
			.select({
				id: table.marketingCollection.id,
				tenantId: table.marketingCollection.tenantId,
				clientId: table.marketingCollection.clientId,
				name: table.marketingCollection.name,
				description: table.marketingCollection.description,
				color: table.marketingCollection.color,
				createdAt: table.marketingCollection.createdAt,
				updatedAt: table.marketingCollection.updatedAt
			})
			.from(table.marketingCollection)
			.where(conditions)
			.orderBy(desc(table.marketingCollection.createdAt))
			.limit(200);

		if (collections.length === 0) return collections.map((c) => ({ ...c, materialCount: 0 }));

		// Batch count materials per collection
		const collectionIds = collections.map((c) => c.id);
		const counts = await db
			.select({
				collectionId: table.marketingCollectionMaterial.collectionId,
				count: table.marketingCollectionMaterial.id
			})
			.from(table.marketingCollectionMaterial)
			.where(inArray(table.marketingCollectionMaterial.collectionId, collectionIds));

		const countMap: Record<string, number> = {};
		for (const row of counts) {
			countMap[row.collectionId] = (countMap[row.collectionId] || 0) + 1;
		}

		return collections.map((c) => ({
			...c,
			materialCount: countMap[c.id] || 0
		}));
	}
);

export const getCollectionMaterialIds = query(
	v.object({
		collectionId: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const links = await db
			.select({ materialId: table.marketingCollectionMaterial.materialId })
			.from(table.marketingCollectionMaterial)
			.where(eq(table.marketingCollectionMaterial.collectionId, data.collectionId));

		return links.map((l) => l.materialId);
	}
);

// ==================== COMMANDS ====================

export const createMarketingCollection = command(
	v.object({
		clientId: v.string(),
		name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
		description: v.optional(v.pipe(v.string(), v.maxLength(500))),
		color: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const id = generateId();
		await db.insert(table.marketingCollection).values({
			id,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			name: data.name,
			description: data.description || null,
			color: data.color || null
		});

		return { id };
	}
);

export const updateMarketingCollection = command(
	v.object({
		id: v.string(),
		name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
		description: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
		color: v.optional(v.nullable(v.string()))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const updates: Record<string, any> = { updatedAt: new Date() };
		if (data.name !== undefined) updates.name = data.name;
		if (data.description !== undefined) updates.description = data.description;
		if (data.color !== undefined) updates.color = data.color;

		await db
			.update(table.marketingCollection)
			.set(updates)
			.where(
				and(
					eq(table.marketingCollection.id, data.id),
					eq(table.marketingCollection.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

export const deleteMarketingCollection = command(
	v.object({ id: v.string() }),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Junction entries cascade-deleted via FK
		await db
			.delete(table.marketingCollection)
			.where(
				and(
					eq(table.marketingCollection.id, data.id),
					eq(table.marketingCollection.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

export const addMaterialsToCollection = command(
	v.object({
		collectionId: v.string(),
		materialIds: v.array(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Check collection belongs to tenant
		const [collection] = await db
			.select({ id: table.marketingCollection.id })
			.from(table.marketingCollection)
			.where(
				and(
					eq(table.marketingCollection.id, data.collectionId),
					eq(table.marketingCollection.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!collection) throw new Error('Colecția nu a fost găsită');

		// Get existing links to avoid duplicates
		const existing = await db
			.select({ materialId: table.marketingCollectionMaterial.materialId })
			.from(table.marketingCollectionMaterial)
			.where(eq(table.marketingCollectionMaterial.collectionId, data.collectionId));

		const existingSet = new Set(existing.map((e) => e.materialId));
		const newIds = data.materialIds.filter((id) => !existingSet.has(id));

		if (newIds.length > 0) {
			await db.insert(table.marketingCollectionMaterial).values(
				newIds.map((materialId) => ({
					id: generateId(),
					collectionId: data.collectionId,
					materialId
				}))
			);
		}

		return { added: newIds.length };
	}
);

export const removeMaterialFromCollection = command(
	v.object({
		collectionId: v.string(),
		materialId: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		await db
			.delete(table.marketingCollectionMaterial)
			.where(
				and(
					eq(table.marketingCollectionMaterial.collectionId, data.collectionId),
					eq(table.marketingCollectionMaterial.materialId, data.materialId)
				)
			);

		return { success: true };
	}
);
