import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, not, inArray, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { recordTaskActivity } from '$lib/server/task-activity';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getTaskMaterials = query(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId: string) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [task] = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);

		if (!task) throw new Error('Task not found');

		return db
			.select({
				id: table.taskMarketingMaterial.id,
				taskId: table.taskMarketingMaterial.taskId,
				materialId: table.marketingMaterial.id,
				materialType: table.marketingMaterial.type,
				materialTitle: table.marketingMaterial.title,
				materialDescription: table.marketingMaterial.description,
				materialExternalUrl: table.marketingMaterial.externalUrl,
				materialFileName: table.marketingMaterial.fileName,
				materialCategory: table.marketingMaterial.category,
				createdAt: table.taskMarketingMaterial.createdAt
			})
			.from(table.taskMarketingMaterial)
			.innerJoin(
				table.marketingMaterial,
				eq(table.taskMarketingMaterial.marketingMaterialId, table.marketingMaterial.id)
			)
			.where(eq(table.taskMarketingMaterial.taskId, taskId))
			.orderBy(desc(table.taskMarketingMaterial.createdAt));
	}
);

export const getAvailableMaterialsForTask = query(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId: string) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [task] = await db
			.select({ id: table.task.id, clientId: table.task.clientId })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);

		if (!task) throw new Error('Task not found');

		// Get already-linked material IDs
		const linked = await db
			.select({ materialId: table.taskMarketingMaterial.marketingMaterialId })
			.from(table.taskMarketingMaterial)
			.where(eq(table.taskMarketingMaterial.taskId, taskId));

		const linkedIds = linked.map((l) => l.materialId);

		const conditions = [
			eq(table.marketingMaterial.tenantId, tenantId),
			eq(table.marketingMaterial.status, 'active')
		];

		if (task.clientId) {
			conditions.push(eq(table.marketingMaterial.clientId, task.clientId));
		}

		if (linkedIds.length > 0) {
			conditions.push(not(inArray(table.marketingMaterial.id, linkedIds)));
		}

		return db
			.select({
				id: table.marketingMaterial.id,
				type: table.marketingMaterial.type,
				title: table.marketingMaterial.title,
				category: table.marketingMaterial.category,
				externalUrl: table.marketingMaterial.externalUrl,
				fileName: table.marketingMaterial.fileName
			})
			.from(table.marketingMaterial)
			.where(and(...conditions))
			.orderBy(desc(table.marketingMaterial.createdAt))
			.limit(100);
	}
);

export const linkMaterialToTask = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		materialId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [task] = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);

		if (!task) throw new Error('Task not found');

		const [material] = await db
			.select({ id: table.marketingMaterial.id, title: table.marketingMaterial.title })
			.from(table.marketingMaterial)
			.where(
				and(
					eq(table.marketingMaterial.id, data.materialId),
					eq(table.marketingMaterial.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!material) throw new Error('Material not found');

		// Check for duplicate
		const [existing] = await db
			.select({ id: table.taskMarketingMaterial.id })
			.from(table.taskMarketingMaterial)
			.where(
				and(
					eq(table.taskMarketingMaterial.taskId, data.taskId),
					eq(table.taskMarketingMaterial.marketingMaterialId, data.materialId)
				)
			)
			.limit(1);

		if (existing) throw new Error('Material deja asociat acestui task');

		const id = generateId();
		await db.insert(table.taskMarketingMaterial).values({
			id,
			tenantId,
			taskId: data.taskId,
			marketingMaterialId: data.materialId,
			addedByUserId: event.locals.user.id
		});

		await recordTaskActivity({
			taskId: data.taskId,
			userId: event.locals.user.id,
			tenantId,
			action: 'updated',
			field: 'materials',
			newValue: material.title
		});

		return { success: true, id };
	}
);

export const unlinkMaterialFromTask = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		materialId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [task] = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);

		if (!task) throw new Error('Task not found');

		// Get material title for activity
		const [link] = await db
			.select({ materialId: table.taskMarketingMaterial.marketingMaterialId })
			.from(table.taskMarketingMaterial)
			.where(
				and(
					eq(table.taskMarketingMaterial.taskId, data.taskId),
					eq(table.taskMarketingMaterial.marketingMaterialId, data.materialId)
				)
			)
			.limit(1);

		if (!link) throw new Error('Link not found');

		const [material] = await db
			.select({ title: table.marketingMaterial.title })
			.from(table.marketingMaterial)
			.where(eq(table.marketingMaterial.id, data.materialId))
			.limit(1);

		await db
			.delete(table.taskMarketingMaterial)
			.where(
				and(
					eq(table.taskMarketingMaterial.taskId, data.taskId),
					eq(table.taskMarketingMaterial.marketingMaterialId, data.materialId),
					eq(table.taskMarketingMaterial.tenantId, tenantId)
				)
			);

		await recordTaskActivity({
			taskId: data.taskId,
			userId: event.locals.user.id,
			tenantId,
			action: 'updated',
			field: 'materials',
			oldValue: material?.title || 'material'
		});

		return { success: true };
	}
);
