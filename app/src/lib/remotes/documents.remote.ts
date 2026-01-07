import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';

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

		if (filters.clientId) {
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

export const getDownloadUrl = query(
	v.pipe(v.string(), v.minLength(1)),
	async (documentId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [document] = await db
			.select()
			.from(table.document)
			.where(and(eq(table.document.id, documentId), eq(table.document.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!document) {
			throw new Error('Document not found');
		}

		const url = await storage.getDownloadUrl(document.filePath);
		return { url, document };
	}
);

export const deleteDocument = command(
	v.pipe(v.string(), v.minLength(1)),
	async (documentId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [document] = await db
			.select()
			.from(table.document)
			.where(and(eq(table.document.id, documentId), eq(table.document.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!document) {
			throw new Error('Document not found');
		}

		// Delete from storage
		await storage.deleteFile(document.filePath);

		// Delete from database
		await db.delete(table.document).where(eq(table.document.id, documentId));

		return { success: true };
	}
);
