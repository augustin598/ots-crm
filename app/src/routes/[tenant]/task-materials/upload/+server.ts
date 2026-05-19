import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import * as storage from '$lib/server/storage';
import { randomUUID } from 'node:crypto';

const ALLOWED_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/svg+xml',
	'video/mp4',
	'video/quicktime',
	'video/webm',
	'application/pdf',
	'application/zip',
	'application/x-zip-compressed'
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function sanitizeFileName(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9._-]/g, '_')
		.replace(/\.{2,}/g, '_')
		.slice(0, 200);
}

function inferMaterialType(mimeType: string, fileName: string): string {
	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType.startsWith('video/')) return 'video';
	if (mimeType === 'application/pdf') return 'document';
	if (mimeType.includes('zip')) return 'document';
	const lower = fileName.toLowerCase();
	if (/\.(mp4|mov|webm|mkv)$/.test(lower)) return 'video';
	if (/\.(jpe?g|png|gif|webp|svg)$/.test(lower)) return 'image';
	return 'document';
}

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const tenant = event.locals.tenant;
	if (!user || !tenant) {
		throw error(401, 'Unauthorized');
	}

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	const taskId = formData.get('taskId') as string | null;

	if (!file || !taskId) {
		throw error(400, 'Lipsesc file sau taskId');
	}

	// Validate file size
	if (file.size > MAX_FILE_SIZE) {
		throw error(400, 'Fișierul depășește limita de 50 MB');
	}

	// Validate MIME type
	if (!ALLOWED_TYPES.includes(file.type)) {
		throw error(400, 'Tip de fișier nepermis. Sunt acceptate: imagini, video, PDF, ZIP');
	}

	// Verify task belongs to current tenant
	const [task] = await db
		.select({ id: table.task.id, clientId: table.task.clientId, tenantId: table.task.tenantId })
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenant.id)))
		.limit(1);

	if (!task) {
		throw error(404, 'Task negăsit');
	}

	// If caller is a client user, verify they belong to the task's client
	if (event.locals.isClientUser) {
		const clientRecord = event.locals.client;
		if (!clientRecord || clientRecord.id !== task.clientId) {
			throw error(403, 'Acces interzis');
		}
	}

	// clientId is required for marketingMaterial — fall back to empty string guard
	if (!task.clientId) {
		throw error(422, 'Task-ul nu are un client asociat — nu se pot atașa materiale');
	}

	// Upload to MinIO
	const safeName = sanitizeFileName(file.name);
	const fileId = randomUUID();
	const minioPath = `uploads/${tenant.id}/task-materials/${taskId}/${fileId}-${safeName}`;

	const buffer = Buffer.from(await file.arrayBuffer());
	const { size, mimeType } = await (async () => {
		const result = await storage.uploadFile(tenant.id, file, {
			type: 'task-material',
			taskId,
			originalName: file.name
		});
		return result;
	})();

	// Insert marketingMaterial row
	const materialId = randomUUID();
	await db.insert(table.marketingMaterial).values({
		id: materialId,
		tenantId: tenant.id,
		clientId: task.clientId,
		type: inferMaterialType(file.type, file.name),
		category: 'google-ads', // default category; can be updated later
		title: file.name,
		fileName: file.name,
		filePath: minioPath,
		fileSize: file.size,
		mimeType: file.type,
		status: 'active',
		uploadedByUserId: event.locals.isClientUser ? null : user.id,
		uploadedByClientUserId: event.locals.isClientUser ? user.id : null
	});

	// Link material to task
	const linkId = randomUUID();
	await db.insert(table.taskMarketingMaterial).values({
		id: linkId,
		tenantId: tenant.id,
		taskId: task.id,
		marketingMaterialId: materialId,
		addedByUserId: user.id
	});

	return json({
		materialId,
		path: minioPath,
		mimeType: file.type,
		fileName: file.name,
		size: file.size
	});
};
