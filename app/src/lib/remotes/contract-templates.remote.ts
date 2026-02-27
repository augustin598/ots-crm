import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateTemplateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getContractTemplates = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	return await db
		.select()
		.from(table.contractTemplate)
		.where(eq(table.contractTemplate.tenantId, event.locals.tenant.id));
});

export const getContractTemplate = query(
	v.pipe(v.string(), v.minLength(1)),
	async (templateId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [template] = await db
			.select()
			.from(table.contractTemplate)
			.where(
				and(
					eq(table.contractTemplate.id, templateId),
					eq(table.contractTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!template) {
			throw new Error('Template not found');
		}

		return template;
	}
);

export const createContractTemplate = command(
	v.object({
		name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
		description: v.optional(v.string()),
		clausesJson: v.optional(v.string()),
		isActive: v.optional(v.boolean())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const templateId = generateTemplateId();

		await db.insert(table.contractTemplate).values({
			id: templateId,
			tenantId: event.locals.tenant.id,
			name: data.name,
			description: data.description || null,
			content: data.name, // kept for backwards compat
			clausesJson: data.clausesJson || null,
			isActive: data.isActive !== undefined ? data.isActive : true,
			createdByUserId: event.locals.user.id
		});

		return { success: true, templateId };
	}
);

export const updateContractTemplate = command(
	v.object({
		templateId: v.pipe(v.string(), v.minLength(1)),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		clausesJson: v.optional(v.string()),
		isActive: v.optional(v.boolean())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [existing] = await db
			.select()
			.from(table.contractTemplate)
			.where(
				and(
					eq(table.contractTemplate.id, data.templateId),
					eq(table.contractTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Template not found');
		}

		await db
			.update(table.contractTemplate)
			.set({
				name: data.name || undefined,
				description: data.description !== undefined ? data.description || null : undefined,
				content: data.name || undefined,
				clausesJson: data.clausesJson !== undefined ? data.clausesJson || null : undefined,
				isActive: data.isActive !== undefined ? data.isActive : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.contractTemplate.id, data.templateId));

		return { success: true };
	}
);

export const deleteContractTemplate = command(
	v.pipe(v.string(), v.minLength(1)),
	async (templateId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [existing] = await db
			.select()
			.from(table.contractTemplate)
			.where(
				and(
					eq(table.contractTemplate.id, templateId),
					eq(table.contractTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Template not found');
		}

		await db.delete(table.contractTemplate).where(eq(table.contractTemplate.id, templateId));

		return { success: true };
	}
);
