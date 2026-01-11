import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { extractVariables } from '$lib/utils/document-variables';

function generateTemplateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const variableSchema = v.object({
	key: v.string(),
	label: v.string(),
	defaultValue: v.optional(v.string())
});

const stylingSchema = v.object({
	primaryColor: v.optional(v.string()),
	secondaryColor: v.optional(v.string()),
	fontFamily: v.optional(v.string()),
	fontSize: v.optional(v.string()),
	header: v.optional(
		v.object({
			content: v.string(),
			height: v.optional(v.number())
		})
	),
	footer: v.optional(
		v.object({
			content: v.string(),
			height: v.optional(v.number())
		})
	)
});

const templateSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	description: v.optional(v.string()),
	type: v.pipe(v.string(), v.picklist(['offer', 'contract', 'generic'], 'Type must be offer, contract, or generic')),
	content: v.pipe(v.string(), v.minLength(1, 'Content is required')),
	variables: v.optional(v.array(variableSchema)),
	styling: v.optional(stylingSchema),
	isActive: v.optional(v.boolean())
});

export const getDocumentTemplates = query(
	v.optional(
		v.object({
			type: v.optional(v.string())
		})
	),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.documentTemplate.tenantId, event.locals.tenant.id);

		if (filters && filters.type) {
			conditions = and(conditions, eq(table.documentTemplate.type, filters.type)) as any;
		}

		return await db.select().from(table.documentTemplate).where(conditions);
	}
);

export const getDocumentTemplate = query(
	v.pipe(v.string(), v.minLength(1)),
	async (templateId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [template] = await db
			.select()
			.from(table.documentTemplate)
			.where(
				and(
					eq(table.documentTemplate.id, templateId),
					eq(table.documentTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!template) {
			throw new Error('Template not found');
		}

		return template;
	}
);

export const createDocumentTemplate = command(templateSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const templateId = generateTemplateId();

	await db.insert(table.documentTemplate).values({
		id: templateId,
		tenantId: event.locals.tenant.id,
		name: data.name,
		description: data.description || null,
		type: data.type,
		content: data.content,
		variables: data.variables || [],
		styling: data.styling || null,
		isActive: data.isActive !== undefined ? data.isActive : true,
		createdByUserId: event.locals.user.id
	});

	return { success: true, templateId };
});

export const updateDocumentTemplate = command(
	v.object({
		templateId: v.pipe(v.string(), v.minLength(1)),
		data: templateSchema
	}),
	async ({ templateId, data }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify template belongs to tenant
		const [existing] = await db
			.select()
			.from(table.documentTemplate)
			.where(
				and(
					eq(table.documentTemplate.id, templateId),
					eq(table.documentTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Template not found');
		}

		await db
			.update(table.documentTemplate)
			.set({
				name: data.name,
				description: data.description || null,
				type: data.type,
				content: data.content,
				variables: data.variables || [],
				styling: data.styling || null,
				isActive: data.isActive !== undefined ? data.isActive : true,
				updatedAt: new Date()
			})
			.where(eq(table.documentTemplate.id, templateId));

		return { success: true };
	}
);

export const deleteDocumentTemplate = command(
	v.pipe(v.string(), v.minLength(1)),
	async (templateId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify template belongs to tenant
		const [existing] = await db
			.select()
			.from(table.documentTemplate)
			.where(
				and(
					eq(table.documentTemplate.id, templateId),
					eq(table.documentTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Template not found');
		}

		await db.delete(table.documentTemplate).where(eq(table.documentTemplate.id, templateId));

		return { success: true };
	}
);

export const getTemplateVariables = query(
	v.pipe(v.string(), v.minLength(1)),
	async (templateId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [template] = await db
			.select()
			.from(table.documentTemplate)
			.where(
				and(
					eq(table.documentTemplate.id, templateId),
					eq(table.documentTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!template) {
			throw new Error('Template not found');
		}

		// Extract variables from content
		const contentVariables = extractVariables(template.content);
		
		// Combine with custom variables from template
		const customVariables = template.variables || [];
		const customVariableKeys = new Set(customVariables.map((v) => v.key));

		// Standard variables that are always available
		const standardVariables = [
			'tenant.name',
			'tenant.cui',
			'tenant.address',
			'tenant.city',
			'tenant.county',
			'tenant.postalCode',
			'tenant.iban',
			'tenant.legalRepresentative',
			'client.name',
			'client.email',
			'client.phone',
			'client.cui',
			'client.address',
			'client.city',
			'client.county',
			'client.postalCode',
			'client.iban',
			'client.legalRepresentative',
			'project.name',
			'project.description',
			'project.budget',
			'project.startDate',
			'project.endDate',
			'date',
			'currentDate',
			'year',
			'month',
			'day'
		];

		// Filter out custom variables that are already defined
		const usedStandardVariables = contentVariables.filter((v) =>
			standardVariables.includes(v)
		);
		const usedCustomVariables = contentVariables.filter(
			(v) => !standardVariables.includes(v) && !customVariableKeys.has(v)
		);

		return {
			standard: usedStandardVariables,
			custom: customVariables,
			undefined: usedCustomVariables // Variables used but not defined
		};
	}
);
