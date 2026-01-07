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

const templateSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	description: v.optional(v.string()),
	content: v.pipe(v.string(), v.minLength(1, 'Content is required')),
	variables: v.optional(v.array(v.string())),
	isActive: v.optional(v.boolean())
});

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
			.where(and(eq(table.contractTemplate.id, templateId), eq(table.contractTemplate.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!template) {
			throw new Error('Template not found');
		}

		return template;
	}
);

export const createContractTemplate = command(templateSchema, async (data) => {
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
		content: data.content,
		variables: data.variables || [],
		isActive: data.isActive !== undefined ? data.isActive : true,
		createdByUserId: event.locals.user.id
	});

	return { success: true, templateId };
});

export const generateContractFromTemplate = command(
	v.object({
		templateId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.pipe(v.string(), v.minLength(1)),
		projectId: v.optional(v.string()),
		variables: v.optional(v.record(v.string(), v.string()))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get template
		const [template] = await db
			.select()
			.from(table.contractTemplate)
			.where(and(eq(table.contractTemplate.id, data.templateId), eq(table.contractTemplate.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!template) {
			throw new Error('Template not found');
		}

		// Get client
		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!client) {
			throw new Error('Client not found');
		}

		// Get project if provided
		let project = null;
		if (data.projectId) {
			const [projectResult] = await db
				.select()
				.from(table.project)
				.where(and(eq(table.project.id, data.projectId), eq(table.project.tenantId, event.locals.tenant.id)))
				.limit(1);
			project = projectResult || null;
		}

		// Replace template variables
		let content = template.content;
		
		// Replace tenant variables
		content = content.replace(/\{\{tenant\.name\}\}/g, event.locals.tenant.name || '');
		content = content.replace(/\{\{tenant\.cui\}\}/g, event.locals.tenant.cui || '');
		content = content.replace(/\{\{tenant\.registrationNumber\}\}/g, event.locals.tenant.registrationNumber || '');
		content = content.replace(/\{\{tenant\.tradeRegister\}\}/g, event.locals.tenant.tradeRegister || '');
		content = content.replace(/\{\{tenant\.iban\}\}/g, event.locals.tenant.iban || '');
		content = content.replace(/\{\{tenant\.address\}\}/g, event.locals.tenant.address || '');
		content = content.replace(/\{\{tenant\.city\}\}/g, event.locals.tenant.city || '');
		content = content.replace(/\{\{tenant\.county\}\}/g, event.locals.tenant.county || '');
		content = content.replace(/\{\{tenant\.postalCode\}\}/g, event.locals.tenant.postalCode || '');
		content = content.replace(/\{\{tenant\.legalRepresentative\}\}/g, event.locals.tenant.legalRepresentative || '');

		// Replace client variables
		content = content.replace(/\{\{client\.name\}\}/g, client.name || '');
		content = content.replace(/\{\{client\.cui\}\}/g, client.cui || '');
		content = content.replace(/\{\{client\.registrationNumber\}\}/g, client.registrationNumber || '');
		content = content.replace(/\{\{client\.tradeRegister\}\}/g, client.tradeRegister || '');
		content = content.replace(/\{\{client\.iban\}\}/g, client.iban || '');
		content = content.replace(/\{\{client\.address\}\}/g, client.address || '');
		content = content.replace(/\{\{client\.city\}\}/g, client.city || '');
		content = content.replace(/\{\{client\.county\}\}/g, client.county || '');
		content = content.replace(/\{\{client\.postalCode\}\}/g, client.postalCode || '');
		content = content.replace(/\{\{client\.legalRepresentative\}\}/g, client.legalRepresentative || '');
		content = content.replace(/\{\{client\.email\}\}/g, client.email || '');
		content = content.replace(/\{\{client\.phone\}\}/g, client.phone || '');

		// Replace project variables
		if (project) {
			content = content.replace(/\{\{project\.name\}\}/g, project.name || '');
			content = content.replace(/\{\{project\.description\}\}/g, project.description || '');
			content = content.replace(/\{\{project\.budget\}\}/g, project.budget ? `€${(project.budget / 100).toFixed(2)}` : '');
			content = content.replace(/\{\{project\.startDate\}\}/g, project.startDate ? new Date(project.startDate).toLocaleDateString() : '');
			content = content.replace(/\{\{project\.endDate\}\}/g, project.endDate ? new Date(project.endDate).toLocaleDateString() : '');
		}

		// Replace system variables
		const now = new Date();
		content = content.replace(/\{\{date\}\}/g, now.toLocaleDateString());
		content = content.replace(/\{\{currentDate\}\}/g, now.toLocaleDateString());
		content = content.replace(/\{\{year\}\}/g, now.getFullYear().toString());

		// Replace custom variables
		if (data.variables) {
			for (const [key, value] of Object.entries(data.variables)) {
				content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
			}
		}

		// Create document from generated content
		const documentId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		const fileName = `contract-${documentId}.txt`;
		const fileBuffer = Buffer.from(content, 'utf-8');

		// Upload to storage
		const { uploadFile } = await import('$lib/server/storage');
		const uploadResult = await uploadFile(
			event.locals.tenant.id,
			new File([fileBuffer], fileName, { type: 'text/plain' })
		);

		// Save document record
		await db.insert(table.document).values({
			id: documentId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			projectId: data.projectId || null,
			contractTemplateId: template.id,
			name: `${template.name} - ${client.name}`,
			type: 'contract',
			filePath: uploadResult.path,
			fileSize: uploadResult.size,
			mimeType: uploadResult.mimeType,
			uploadedByUserId: event.locals.user.id
		});

		return { success: true, documentId };
	}
);
