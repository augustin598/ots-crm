import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateMilestoneId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const milestoneSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	description: v.optional(v.string()),
	projectId: v.pipe(v.string(), v.minLength(1, 'Project ID is required')),
	status: v.optional(v.string()),
	dueDate: v.optional(v.string()),
	completedDate: v.optional(v.string())
});

export const getMilestones = query(
	v.optional(v.pipe(v.string(), v.minLength(1))),
	async (projectId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.milestone.tenantId, event.locals.tenant.id);

		if (projectId) {
			conditions = and(conditions, eq(table.milestone.projectId, projectId)) as any;
		}

		return await db.select().from(table.milestone).where(conditions);
	}
);

export const getMilestone = query(
	v.pipe(v.string(), v.minLength(1)),
	async (milestoneId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [milestone] = await db
			.select()
			.from(table.milestone)
			.where(
				and(
					eq(table.milestone.id, milestoneId),
					eq(table.milestone.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!milestone) {
			throw new Error('Milestone not found');
		}

		return milestone;
	}
);

export const createMilestone = command(milestoneSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify project belongs to tenant
	const [project] = await db
		.select()
		.from(table.project)
		.where(
			and(
				eq(table.project.id, data.projectId),
				eq(table.project.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (!project) {
		throw new Error('Project not found');
	}

	const milestoneId = generateMilestoneId();

	await db.insert(table.milestone).values({
		id: milestoneId,
		tenantId: event.locals.tenant.id,
		projectId: data.projectId,
		name: data.name,
		description: data.description || null,
		status: data.status || 'pending',
		dueDate: data.dueDate ? new Date(data.dueDate) : null,
		completedDate: data.completedDate ? new Date(data.completedDate) : null
	});

	return { success: true, milestoneId };
});

export const updateMilestone = command(
	v.object({
		milestoneId: v.pipe(v.string(), v.minLength(1)),
		...milestoneSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { milestoneId, ...updateData } = data;

		const [existing] = await db
			.select()
			.from(table.milestone)
			.where(
				and(
					eq(table.milestone.id, milestoneId),
					eq(table.milestone.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Milestone not found');
		}

		await db
			.update(table.milestone)
			.set({
				...updateData,
				dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
				completedDate: updateData.completedDate ? new Date(updateData.completedDate) : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.milestone.id, milestoneId));

		return { success: true };
	}
);

export const deleteMilestone = command(
	v.pipe(v.string(), v.minLength(1)),
	async (milestoneId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [existing] = await db
			.select()
			.from(table.milestone)
			.where(
				and(
					eq(table.milestone.id, milestoneId),
					eq(table.milestone.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Milestone not found');
		}

		await db.delete(table.milestone).where(eq(table.milestone.id, milestoneId));

		return { success: true };
	}
);
