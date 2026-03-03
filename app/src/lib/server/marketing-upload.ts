import type { RequestEvent } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, like, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';

function generateMaterialId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_DOC_TYPES = [
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB

function detectType(mimeType: string): 'image' | 'video' | 'document' {
	if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return 'image';
	if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return 'video';
	if (ALLOWED_DOC_TYPES.includes(mimeType)) return 'document';
	throw new Error('Tip de fișier neacceptat');
}

function getMaxSize(mimeType: string): number {
	if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return MAX_IMAGE_SIZE;
	if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return MAX_VIDEO_SIZE;
	return MAX_DOC_SIZE;
}

async function validateMagicBytes(file: File): Promise<boolean> {
	const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());

	// PDF: %PDF
	if (file.type === 'application/pdf') {
		return String.fromCharCode(header[0], header[1], header[2], header[3]) === '%PDF';
	}
	// JPEG: FF D8 FF
	if (file.type === 'image/jpeg') {
		return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
	}
	// PNG: 89 50 4E 47
	if (file.type === 'image/png') {
		return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
	}
	// GIF: GIF87a or GIF89a
	if (file.type === 'image/gif') {
		const sig = String.fromCharCode(header[0], header[1], header[2]);
		return sig === 'GIF';
	}
	// WebP: RIFF....WEBP
	if (file.type === 'image/webp') {
		return (
			header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
		);
	}
	// MP4: ftyp at offset 4
	if (file.type === 'video/mp4') {
		return (
			header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70
		);
	}
	// WebM: 1A 45 DF A3
	if (file.type === 'video/webm') {
		return header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
	}
	// DOC/DOCX: PK (zip) or D0 CF (OLE)
	if (
		file.type === 'application/msword' ||
		file.type ===
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	) {
		const isPK = header[0] === 0x50 && header[1] === 0x4b;
		const isOLE = header[0] === 0xd0 && header[1] === 0xcf;
		return isPK || isOLE;
	}

	return false;
}

function escapeLike(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveUniqueTitle(
	tenantId: string,
	clientId: string,
	category: string,
	baseTitle: string
): Promise<string> {
	const escapedTitle = escapeLike(baseTitle);
	const existing = await db
		.select({ title: table.marketingMaterial.title })
		.from(table.marketingMaterial)
		.where(
			and(
				eq(table.marketingMaterial.tenantId, tenantId),
				eq(table.marketingMaterial.clientId, clientId),
				eq(table.marketingMaterial.category, category),
				or(
					eq(table.marketingMaterial.title, baseTitle),
					sql`${table.marketingMaterial.title} LIKE ${escapedTitle + ' (%)'} ESCAPE '\\'`
				)
			)
		);

	if (existing.length === 0) return baseTitle;

	const existingTitles = new Set(existing.map((e) => e.title));
	if (!existingTitles.has(baseTitle)) return baseTitle;

	let maxSuffix = 0;
	const suffixPattern = new RegExp(`^${escapeRegex(baseTitle)} \\((\\d+)\\)$`);
	for (const e of existing) {
		const match = e.title?.match(suffixPattern);
		if (match) {
			const num = parseInt(match[1], 10);
			if (num > maxSuffix) maxSuffix = num;
		}
	}

	return `${baseTitle} (${maxSuffix + 1})`;
}

export async function handleMarketingUpload(event: RequestEvent): Promise<Response> {
	const tenantId = event.locals.tenant?.id;
	const userId = event.locals.user?.id;
	const isClientUser = event.locals.isClientUser;
	const clientUserId = isClientUser ? (event.locals as any).clientUser?.id : null;

	if (!userId || !tenantId) {
		throw error(401, 'Unauthorized');
	}

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	const clientId = formData.get('clientId') as string;
	const category = formData.get('category') as string;
	let title = formData.get('title') as string;
	const description = (formData.get('description') as string) || null;
	const seoLinkId = (formData.get('seoLinkId') as string) || null;
	const tags = (formData.get('tags') as string) || null;
	const autoRename = formData.get('autoRename') === 'true';

	if (!clientId || !category || !title) {
		throw error(400, 'clientId, category și title sunt obligatorii');
	}

	const validCategories = ['google-ads', 'facebook-ads', 'tiktok-ads', 'press-article', 'seo-article'];
	if (!validCategories.includes(category)) {
		throw error(400, 'Categorie invalidă');
	}

	// Validate clientId belongs to tenant
	if (isClientUser && event.locals.client) {
		if (clientId !== event.locals.client.id) {
			throw error(403, 'Nu puteți uploada pentru alt client');
		}
	} else {
		const [clientCheck] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);

		if (!clientCheck) {
			throw error(400, 'Client invalid sau nu aparține acestui tenant');
		}
	}

	if (!file || !(file instanceof File)) {
		throw error(400, 'Fișierul este obligatoriu');
	}

	const allAllowed = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_DOC_TYPES];
	if (!allAllowed.includes(file.type)) {
		throw error(400, 'Tip de fișier neacceptat. Acceptăm: imagini (jpg, png, gif, webp), video (mp4, webm), documente (pdf, doc, docx)');
	}

	const maxSize = getMaxSize(file.type);
	if (file.size > maxSize) {
		throw error(400, `Fișierul depășește dimensiunea maximă de ${maxSize / (1024 * 1024)}MB`);
	}

	const validBytes = await validateMagicBytes(file);
	if (!validBytes) {
		throw error(400, 'Fișierul nu corespunde tipului declarat');
	}

	// Validate seoLinkId if provided
	if (seoLinkId) {
		const [seoLinkCheck] = await db
			.select({ id: table.seoLink.id })
			.from(table.seoLink)
			.where(and(eq(table.seoLink.id, seoLinkId), eq(table.seoLink.tenantId, tenantId)))
			.limit(1);

		if (!seoLinkCheck) {
			throw error(400, 'SEO Link invalid');
		}
	}

	const uploadResult = await storage.uploadFile(tenantId, file, {
		type: 'marketing',
		clientId,
		category
	});

	if (autoRename) {
		title = await resolveUniqueTitle(tenantId, clientId, category, title);
	}

	const materialId = generateMaterialId();
	const materialType = detectType(file.type);

	await db.insert(table.marketingMaterial).values({
		id: materialId,
		tenantId,
		clientId,
		category,
		type: materialType,
		title,
		description,
		filePath: uploadResult.path,
		fileSize: uploadResult.size,
		mimeType: uploadResult.mimeType,
		fileName: file.name,
		seoLinkId,
		status: 'active',
		uploadedByUserId: isClientUser ? null : userId,
		uploadedByClientUserId: clientUserId || null,
		tags
	});

	return json({ success: true, materialId });
}
