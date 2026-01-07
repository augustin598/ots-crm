import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateProjectId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const projectSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	description: v.optional(v.string()),
	clientId: v.pipe(v.string(), v.minLength(1, 'Client ID is required')),
	status: v.optional(v.string()),
	startDate: v.optional(v.string()),
	endDate: v.optional(v.string()),
	budget: v.optional(v.number())
});

export const getProjects = query(
	v.optional(v.pipe(v.string(), v.minLength(1))),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.project.tenantId, event.locals.tenant.id);

		if (clientId) {
			conditions = and(conditions, eq(table.project.clientId, clientId)) as any;
		}

		return await db.select().from(table.project).where(conditions);
	}
);

export const getProject = query(
	v.pipe(v.string(), v.minLength(1)),
	async (projectId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [project] = await db
			.select()
			.from(table.project)
			.where(and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!project) {
			throw new Error('Project not found');
		}

		return project;
	}
);

export const createProject = command(projectSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify client belongs to tenant
	const [client] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!client) {
		throw new Error('Client not found');
	}

	const projectId = generateProjectId();

	await db.insert(table.project).values({
		id: projectId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		name: data.name,
		description: data.description || null,
		status: data.status || 'planning',
		startDate: data.startDate ? new Date(data.startDate) : null,
		endDate: data.endDate ? new Date(data.endDate) : null,
		budget: data.budget ? Math.round(data.budget * 100) : null
	});

	return { success: true, projectId };
});

export const updateProject = command(
	v.object({
		projectId: v.pipe(v.string(), v.minLength(1)),
		...projectSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { projectId, ...updateData } = data;

		const [existing] = await db
			.select()
			.from(table.project)
			.where(and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Project not found');
		}

		await db
			.update(table.project)
			.set({
				...updateData,
				startDate: updateData.startDate ? new Date(updateData.startDate) : undefined,
				endDate: updateData.endDate ? new Date(updateData.endDate) : undefined,
				budget: updateData.budget ? Math.round(updateData.budget * 100) : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.project.id, projectId));

		return { success: true };
	}
);

export const deleteProject = command(
	v.pipe(v.string(), v.minLength(1)),
	async (projectId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [existing] = await db
			.select()
			.from(table.project)
			.where(and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Project not found');
		}

		await db.delete(table.project).where(eq(table.project.id, projectId));

		return { success: true };
	}
);
