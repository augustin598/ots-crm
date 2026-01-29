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

function generateProjectUserId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateProjectPartnerId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const projectSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	description: v.optional(v.string()),
	clientId: v.optional(v.pipe(v.string(), v.minLength(1))),
	status: v.optional(v.string()),
	startDate: v.optional(v.string()),
	endDate: v.optional(v.string()),
	budget: v.optional(v.number()),
	currency: v.optional(v.string()) // 'RON', 'EUR', 'USD', etc.
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

		const ownedProjects = await db.select().from(table.project).where(conditions);

		const sharedProjects = await db
			.select({
				project: table.project
			})
			.from(table.project)
			.innerJoin(table.projectPartner, eq(table.project.id, table.projectPartner.projectId))
			.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
			.where(eq(table.partner.partnerTenantId, event.locals.tenant.id));

		// If clientId is provided, we filter shared projects too?
		// Typically shared projects might not match the *partner's* client list logic,
		// but if the user is filtering by a client ID, they probably mean *their* client.
		// However, the project belongs to the *other* tenant's client.
		// So filtering shared projects by clientId (which is an ID from the *current* tenant) doesn't make sense
		// unless we mapped clients, which we don't.
		// So we only return shared projects if clientId is NOT provided.
		if (clientId) {
			return ownedProjects;
		}

		return [...ownedProjects, ...sharedProjects.map((p) => p.project)];
	}
);

export const getProject = query(v.pipe(v.string(), v.minLength(1)), async (projectId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [project] = await db
		.select()
		.from(table.project)
		.where(and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (project) {
		return project;
	}

	// Check if shared
	const [sharedProject] = await db
		.select({ project: table.project })
		.from(table.project)
		.innerJoin(table.projectPartner, eq(table.project.id, table.projectPartner.projectId))
		.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
		.where(
			and(
				eq(table.project.id, projectId),
				eq(table.partner.partnerTenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (sharedProject) {
		return sharedProject.project;
	}

	throw new Error('Project not found');
});

export const createProject = command(projectSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify client belongs to tenant if clientId is provided
	if (data.clientId) {
		const [client] = await db
			.select()
			.from(table.client)
			.where(
				and(eq(table.client.id, data.clientId), eq(table.client.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!client) {
			throw new Error('Client not found');
		}
	}

	// Get default currency from invoice settings
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';

	const projectId = generateProjectId();

	await db.insert(table.project).values({
		id: projectId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId || null,
		name: data.name,
		description: data.description || null,
		status: data.status || 'planning',
		startDate: data.startDate ? new Date(data.startDate) : null,
		endDate: data.endDate ? new Date(data.endDate) : null,
		budget: data.budget ? Math.round(data.budget * 100) : null,
		currency
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
			.where(
				and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!existing) {
			throw new Error('Project not found');
		}

		// Verify client belongs to tenant if clientId is provided
		if (updateData.clientId !== undefined && updateData.clientId) {
			const [client] = await db
				.select()
				.from(table.client)
				.where(
					and(
						eq(table.client.id, updateData.clientId),
						eq(table.client.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (!client) {
				throw new Error('Client not found');
			}
		}

		const updateValues: any = {
			name: updateData.name,
			description: updateData.description !== undefined ? updateData.description : undefined,
			status: updateData.status !== undefined ? updateData.status : undefined,
			startDate: updateData.startDate ? new Date(updateData.startDate) : undefined,
			endDate: updateData.endDate ? new Date(updateData.endDate) : undefined,
			budget:
				updateData.budget !== undefined
					? updateData.budget
						? Math.round(updateData.budget * 100)
						: null
					: undefined,
			currency: updateData.currency !== undefined ? updateData.currency : undefined,
			updatedAt: new Date()
		};

		if (updateData.clientId !== undefined) {
			updateValues.clientId = updateData.clientId || null;
		}

		await db.update(table.project).set(updateValues).where(eq(table.project.id, projectId));

		return { success: true };
	}
);

export const deleteProject = command(v.pipe(v.string(), v.minLength(1)), async (projectId) => {
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
});

export const getProjectTeamMembers = query(
	v.pipe(v.string(), v.minLength(1)),
	async (projectId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify project belongs to tenant
		const [project] = await db
			.select()
			.from(table.project)
			.where(
				and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!project) {
			throw new Error('Project not found');
		}

		// Get team members with user details
		const teamMembers = await db
			.select({
				id: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			})
			.from(table.projectUser)
			.innerJoin(table.user, eq(table.projectUser.userId, table.user.id))
			.where(
				and(
					eq(table.projectUser.projectId, projectId),
					eq(table.projectUser.tenantId, event.locals.tenant.id)
				)
			);

		return teamMembers;
	}
);

export const getProjectPartners = query(v.pipe(v.string(), v.minLength(1)), async (projectId) => {
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

	const partners = await db
		.select({
			id: table.projectPartner.id,
			projectId: table.projectPartner.projectId,
			partnerId: table.projectPartner.partnerId,
			clientName: table.client.name,
			partnerTenantName: table.tenant.name
		})
		.from(table.projectPartner)
		.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
		.innerJoin(table.client, eq(table.partner.clientId, table.client.id))
		.innerJoin(table.tenant, eq(table.partner.partnerTenantId, table.tenant.id))
		.where(
			and(
				eq(table.projectPartner.projectId, projectId),
				eq(table.projectPartner.tenantId, event.locals.tenant.id)
			)
		);

	return partners;
});

export const updateProjectTeamMembers = command(
	v.object({
		projectId: v.pipe(v.string(), v.minLength(1)),
		userIds: v.array(v.pipe(v.string(), v.minLength(1)))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { projectId, userIds } = data;

		// Verify project belongs to tenant
		const [project] = await db
			.select()
			.from(table.project)
			.where(
				and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!project) {
			throw new Error('Project not found');
		}

		// Verify all users belong to tenant
		if (userIds.length > 0) {
			const tenantUsers = await db
				.select({ userId: table.tenantUser.userId })
				.from(table.tenantUser)
				.where(eq(table.tenantUser.tenantId, event.locals.tenant.id));

			const validUserIds = new Set(tenantUsers.map((tu) => tu.userId));
			const invalidUserIds = userIds.filter((userId) => !validUserIds.has(userId));

			if (invalidUserIds.length > 0) {
				throw new Error('Some users do not belong to this tenant');
			}
		}

		const tenantId = event.locals.tenant.id;

		// Use transaction to delete existing and insert new relationships
		await db.transaction(async (tx) => {
			// Delete existing project-user relationships
			await tx
				.delete(table.projectUser)
				.where(
					and(eq(table.projectUser.projectId, projectId), eq(table.projectUser.tenantId, tenantId))
				);

			// Insert new relationships
			if (userIds.length > 0) {
				await tx.insert(table.projectUser).values(
					userIds.map((userId) => ({
						id: generateProjectUserId(),
						tenantId: tenantId,
						projectId,
						userId
					}))
				);
			}
		});

		return { success: true };
	}
);

export const updateProjectPartner = command(
	v.object({
		projectId: v.pipe(v.string(), v.minLength(1)),
		partnerId: v.optional(v.pipe(v.string(), v.minLength(1)))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { projectId, partnerId } = data;

		const [project] = await db
			.select()
			.from(table.project)
			.where(
				and(eq(table.project.id, projectId), eq(table.project.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!project) {
			throw new Error('Project not found');
		}

		if (partnerId) {
			const [partner] = await db
				.select()
				.from(table.partner)
				.where(
					and(eq(table.partner.id, partnerId), eq(table.partner.tenantId, event.locals.tenant.id))
				)
				.limit(1);

			if (!partner) {
				throw new Error('Partner not found');
			}
		}

		const tenantId = event.locals.tenant.id;

		await db.transaction(async (tx) => {
			await tx
				.delete(table.projectPartner)
				.where(
					and(
						eq(table.projectPartner.projectId, projectId),
						eq(table.projectPartner.tenantId, tenantId)
					)
				);

			if (partnerId) {
				await tx.insert(table.projectPartner).values({
					id: generateProjectPartnerId(),
					tenantId: tenantId,
					projectId,
					partnerId
				});
			}
		});

		return { success: true };
	}
);
