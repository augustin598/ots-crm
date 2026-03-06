import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import * as storage from '$lib/server/storage';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

async function validateMagicBytes(file: File): Promise<boolean> {
	const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());

	if (file.type === 'image/jpeg') {
		return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
	}
	if (file.type === 'image/png') {
		return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
	}
	if (file.type === 'image/gif') {
		const sig = String.fromCharCode(header[0], header[1], header[2]);
		return sig === 'GIF';
	}
	if (file.type === 'image/webp') {
		return header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
	}

	return false;
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
		throw error(400, 'Missing file or taskId');
	}

	// Validate task belongs to tenant
	const [task] = await db
		.select({ id: table.task.id })
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenant.id)))
		.limit(1);

	if (!task) {
		throw error(404, 'Task not found');
	}

	// Validate file type
	if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
		throw error(400, 'Only images are allowed (JPEG, PNG, GIF, WebP)');
	}

	// Validate file size
	if (file.size > MAX_IMAGE_SIZE) {
		throw error(400, 'Image must be under 10MB');
	}

	// Validate magic bytes
	const validMagic = await validateMagicBytes(file);
	if (!validMagic) {
		throw error(400, 'Invalid file content');
	}

	// Upload to MinIO
	const result = await storage.uploadFile(tenant.id, file, { type: 'task-comment-attachment' });

	return json({
		path: result.path,
		mimeType: result.mimeType,
		fileName: file.name,
		size: result.size
	});
};
