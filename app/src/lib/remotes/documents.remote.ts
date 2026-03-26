import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';
import { resolveStandardVariables, replaceVariables } from '$lib/utils/document-variables';
import { generatePDFFromHTML } from '$lib/server/pdf-generator';
import { marked } from 'marked';

function generateDocumentId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getDocuments = query(
	v.object({
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.document.tenantId, event.locals.tenant.id);

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(conditions, eq(table.document.clientId, event.locals.client.id)) as any;
		} else if (filters.clientId) {
			conditions = and(conditions, eq(table.document.clientId, filters.clientId)) as any;
		}
		if (filters.projectId) {
			conditions = and(conditions, eq(table.document.projectId, filters.projectId)) as any;
		}

		return await db.select().from(table.document).where(conditions);
	}
);

export const uploadDocument = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		projectId: v.optional(v.string()),
		name: v.pipe(v.string(), v.minLength(1)),
		type: v.optional(v.string()),
		file: v.instance(File)
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Upload file to storage
		const uploadResult = await storage.uploadFile(event.locals.tenant.id, data.file, {
			clientId: data.clientId,
			projectId: data.projectId || '',
			uploadedBy: event.locals.user.id
		});

		const documentId = generateDocumentId();

		await db.insert(table.document).values({
			id: documentId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			projectId: data.projectId || null,
			name: data.name,
			type: data.type || 'other',
			filePath: uploadResult.path,
			fileSize: uploadResult.size,
			mimeType: uploadResult.mimeType,
			uploadedByUserId: event.locals.user.id
		});

		return { success: true, documentId };
	}
);

export const getDownloadUrl = query(v.pipe(v.string(), v.minLength(1)), async (documentId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	let conditions: any = and(
		eq(table.document.id, documentId),
		eq(table.document.tenantId, event.locals.tenant.id)
	);

	// If user is a client user, ensure document belongs to their client
	if (event.locals.isClientUser && event.locals.client) {
		conditions = and(conditions, eq(table.document.clientId, event.locals.client.id)) as any;
	}

	const [document] = await db.select().from(table.document).where(conditions).limit(1);

	if (!document) {
		throw new Error('Document not found');
	}

	const url = await storage.getDownloadUrl(document.filePath);
	return { url, document };
});

export const deleteDocument = command(v.pipe(v.string(), v.minLength(1)), async (documentId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [document] = await db
		.select()
		.from(table.document)
		.where(
			and(eq(table.document.id, documentId), eq(table.document.tenantId, event.locals.tenant.id))
		)
		.limit(1);

	if (!document) {
		throw new Error('Document not found');
	}

	// Delete from storage
	await storage.deleteFile(document.filePath);

	// Delete from storage
	await storage.deleteFile(document.filePath);

	// Delete from database
	await db.delete(table.document).where(eq(table.document.id, documentId));

	return { success: true };
});

export const generateDocumentFromTemplate = command(
	v.object({
		templateId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.pipe(v.string(), v.minLength(1)),
		projectId: v.optional(v.string()),
		variables: v.optional(v.record(v.string(), v.string())),
		editedContent: v.optional(v.string()) // Optional edited content from preview
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get template
		const [template] = await db
			.select()
			.from(table.documentTemplate)
			.where(
				and(
					eq(table.documentTemplate.id, data.templateId),
					eq(table.documentTemplate.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!template) {
			throw new Error('Template not found');
		}

		// Get client
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

		// Get project if provided
		let project = null;
		if (data.projectId) {
			const [projectResult] = await db
				.select()
				.from(table.project)
				.where(
					and(
						eq(table.project.id, data.projectId),
						eq(table.project.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);
			project = projectResult || null;
		}

		// Resolve variables
		const standardVariables = resolveStandardVariables(
			event.locals.tenant,
			client,
			project,
			data.variables
		);
		const allVariables = { ...standardVariables, ...(data.variables || {}) };

		// Use edited content if provided, otherwise use template content
		const contentToRender = data.editedContent || template.content;

		// Replace variables first
		let contentWithVariables = replaceVariables(contentToRender, allVariables);

		// Convert markdown to HTML
		let renderedContent: string;
		try {
			renderedContent = marked(contentWithVariables) as string;
		} catch (e) {
			// If markdown parsing fails, treat as HTML
			renderedContent = contentWithVariables;
		}

		// Apply styling wrapper if template has styling
		if (template.styling) {
			const styling = template.styling as {
				primaryColor?: string;
				secondaryColor?: string;
				fontFamily?: string;
				fontSize?: string;
			};

			const styles = [];
			if (styling.primaryColor) styles.push(`--primary-color: ${styling.primaryColor}`);
			if (styling.secondaryColor) styles.push(`--secondary-color: ${styling.secondaryColor}`);
			if (styling.fontFamily) styles.push(`font-family: ${styling.fontFamily}`);
			if (styling.fontSize) styles.push(`font-size: ${styling.fontSize}`);

			if (styles.length > 0) {
				renderedContent = `<div style="${styles.join('; ')}">${renderedContent}</div>`;
			}
		}

		// Create document record
		const documentId = generateDocumentId();
		const fileName = `${template.name}-${client.name}-${Date.now()}.html`;
		const fileBuffer = Buffer.from(renderedContent, 'utf-8');

		// Upload to storage
		const uploadResult = await storage.uploadFile(
			event.locals.tenant.id,
			new File([fileBuffer], fileName, { type: 'text/html' })
		);

		// Save document record
		await db.insert(table.document).values({
			id: documentId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			projectId: data.projectId || null,
			documentTemplateId: template.id,
			name: `${template.name} - ${client.name}`,
			type: template.type, // 'offer', 'contract', or 'generic' -> 'other'
			filePath: uploadResult.path,
			fileSize: uploadResult.size,
			mimeType: 'text/html',
			renderedContent: renderedContent,
			pdfGenerated: false,
			uploadedByUserId: event.locals.user.id
		});

		return { success: true, documentId };
	}
);

export const generateDocumentPDF = command(
	v.pipe(v.string(), v.minLength(1)),
	async (documentId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get document
		const [document] = await db
			.select()
			.from(table.document)
			.where(
				and(eq(table.document.id, documentId), eq(table.document.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!document) {
			throw new Error('Document not found');
		}

		if (!document.renderedContent) {
			throw new Error('Document has no rendered content');
		}

		// Get template for styling
		let template = null;
		if (document.documentTemplateId) {
			const [templateResult] = await db
				.select()
				.from(table.documentTemplate)
				.where(eq(table.documentTemplate.id, document.documentTemplateId))
				.limit(1);
			template = templateResult;
		}

		// Generate PDF
		const pdfBuffer = await generatePDFFromHTML(document.renderedContent, {
			header: template?.styling?.header?.content,
			footer: template?.styling?.footer?.content,
			styling: template?.styling as any
		});

		// Upload PDF to storage
		const pdfFileName = document.filePath.replace(/\.html?$/, '.pdf');
		const pdfFile = new File([new Uint8Array(pdfBuffer)], pdfFileName, { type: 'application/pdf' });
		const pdfUploadResult = await storage.uploadFile(event.locals.tenant.id, pdfFile);

		// Update document record
		await db
			.update(table.document)
			.set({
				pdfGenerated: true,
				filePath: pdfUploadResult.path, // Update to PDF path
				mimeType: 'application/pdf',
				fileSize: pdfUploadResult.size
			})
			.where(eq(table.document.id, documentId));

		// Get download URL
		const downloadUrl = await storage.getDownloadUrl(pdfUploadResult.path);

		return { success: true, url: downloadUrl };
	}
);

export const getDocumentPreview = query(v.pipe(v.string(), v.minLength(1)), async (documentId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [document] = await db
		.select()
		.from(table.document)
		.where(
			and(eq(table.document.id, documentId), eq(table.document.tenantId, event.locals.tenant.id))
		)
		.limit(1);

	if (!document) {
		throw new Error('Document not found');
	}

	return {
		html: document.renderedContent || '',
		document
	};
});
