import type { RequestEvent } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';
import { GOOGLE_ADS_SPECS, validateImageDimensions, type GoogleAdsCampaignType } from '$lib/shared/google-ads-specs';

function generateMaterialId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_DOC_TYPES = [
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'text/plain'
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

	// TXT: verify no null bytes (binary file masquerading as text)
	if (file.type === 'text/plain') {
		return !header.some((b) => b === 0x00);
	}

	return false;
}

/** Read image dimensions from raw bytes (PNG/JPEG/WebP/GIF). No external dependencies. */
async function getImageDimensions(file: File): Promise<{ w: number; h: number } | null> {
	try {
		const buf = new Uint8Array(await file.arrayBuffer());

		// PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
		if (file.type === 'image/png' && buf.length > 24) {
			const view = new DataView(buf.buffer);
			return { w: view.getUint32(16), h: view.getUint32(20) };
		}

		// JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
		if (file.type === 'image/jpeg') {
			let offset = 2; // skip SOI
			const view = new DataView(buf.buffer);
			while (offset < buf.length - 8) {
				if (buf[offset] !== 0xff) break;
				const marker = buf[offset + 1];
				if (marker === 0xc0 || marker === 0xc2) {
					const h = view.getUint16(offset + 5);
					const w = view.getUint16(offset + 7);
					return { w, h };
				}
				const segLen = view.getUint16(offset + 2);
				offset += 2 + segLen;
			}
		}

		// GIF: width at 6-7, height at 8-9 (little-endian)
		if (file.type === 'image/gif' && buf.length > 10) {
			const view = new DataView(buf.buffer);
			return { w: view.getUint16(6, true), h: view.getUint16(8, true) };
		}

		// WebP: look for VP8 chunk
		if (file.type === 'image/webp' && buf.length > 30) {
			const view = new DataView(buf.buffer);
			// VP8 (lossy) at offset 12
			const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
			if (chunk === 'VP8 ' && buf.length > 30) {
				const w = view.getUint16(26, true) & 0x3fff;
				const h = view.getUint16(28, true) & 0x3fff;
				return { w, h };
			}
			// VP8L (lossless) at offset 12
			if (chunk === 'VP8L' && buf.length > 25) {
				const bits = view.getUint32(21, true);
				const w = (bits & 0x3fff) + 1;
				const h = ((bits >> 14) & 0x3fff) + 1;
				return { w, h };
			}
		}
	} catch {
		// Fall through
	}
	return null;
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
	const campaignType = (formData.get('campaignType') as string) || null;
	const googleAdsSlotKey = (formData.get('googleAdsSlotKey') as string) || null;

	if (!clientId || !category || !title) {
		throw error(400, 'clientId, category și title sunt obligatorii');
	}

	if (title.length > 200) {
		throw error(400, 'Titlul nu poate depăși 200 de caractere');
	}
	if (description && description.length > 1000) {
		throw error(400, 'Descrierea nu poate depăși 1000 de caractere');
	}
	if (tags && tags.length > 500) {
		throw error(400, 'Tagurile nu pot depăși 500 de caractere');
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

	// Validate image dimensions for Google Ads slots
	if (googleAdsSlotKey && campaignType && ALLOWED_IMAGE_TYPES.includes(file.type)) {
		const spec = GOOGLE_ADS_SPECS[campaignType as GoogleAdsCampaignType];
		if (spec) {
			const slot = spec.imageSlots.find((s) => s.key === googleAdsSlotKey);
			if (slot) {
				// Check file size against slot-specific limit
				if (file.size > slot.maxFileSize) {
					throw error(400, `Fișierul depășește dimensiunea maximă de ${slot.maxFileSize / (1024 * 1024)}MB pentru ${slot.label}`);
				}

				const dims = await getImageDimensions(file);
				if (dims) {
					const validation = validateImageDimensions(dims.w, dims.h, slot);
					if (!validation.valid) {
						throw error(400, validation.error!);
					}
				}
			}
		}
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

	// Extract image dimensions for storage
	let dimensions: string | null = null;
	if (materialType === 'image') {
		const dims = await getImageDimensions(file);
		if (dims) {
			dimensions = `${dims.w}x${dims.h}`;
		}
	}

	try {
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
			dimensions,
			seoLinkId,
			status: 'active',
			campaignType,
			uploadedByUserId: isClientUser ? null : userId,
			uploadedByClientUserId: clientUserId || null,
			tags
		});
	} catch (dbErr) {
		// Cleanup orphan file from storage
		try { await storage.deleteFile(uploadResult.path); } catch { /* best effort */ }
		throw dbErr;
	}

	return json({ success: true, materialId });
}

export async function handleArticleUpload(event: RequestEvent): Promise<Response> {
	const tenantId = event.locals.tenant?.id;
	const userId = event.locals.user?.id;
	const isClientUser = event.locals.isClientUser;
	const clientUserId = isClientUser ? (event.locals as any).clientUser?.id : null;

	if (!userId || !tenantId) {
		throw error(401, 'Unauthorized');
	}

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	const images = formData.getAll('images') as File[];
	const clientId = formData.get('clientId') as string;
	const category = formData.get('category') as string;
	let title = formData.get('title') as string;
	const description = (formData.get('description') as string) || null;
	const tags = (formData.get('tags') as string) || null;

	if (!clientId || !category || !title) {
		throw error(400, 'clientId, category și title sunt obligatorii');
	}

	if (title.length > 200) {
		throw error(400, 'Titlul nu poate depăși 200 de caractere');
	}
	if (description && description.length > 1000) {
		throw error(400, 'Descrierea nu poate depăși 1000 de caractere');
	}
	if (tags && tags.length > 500) {
		throw error(400, 'Tagurile nu pot depăși 500 de caractere');
	}

	if (category !== 'press-article' && category !== 'seo-article') {
		throw error(400, 'Această rută acceptă doar press-article sau seo-article');
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

	// Validate document file (required)
	if (!file || !(file instanceof File)) {
		throw error(400, 'Fișierul document este obligatoriu');
	}

	if (file.size === 0) {
		throw error(400, 'Fișierul nu poate fi gol');
	}

	if (!ALLOWED_DOC_TYPES.includes(file.type)) {
		throw error(400, 'Tip de fișier document neacceptat. Acceptăm: PDF, DOC, DOCX, TXT');
	}

	if (file.size > MAX_DOC_SIZE) {
		throw error(400, `Documentul depășește dimensiunea maximă de ${MAX_DOC_SIZE / (1024 * 1024)}MB`);
	}

	const validDocBytes = await validateMagicBytes(file);
	if (!validDocBytes) {
		throw error(400, 'Fișierul document nu corespunde tipului declarat');
	}

	// Validate images (optional, max 3)
	if (images.length > 3) {
		throw error(400, 'Maximum 3 imagini permise');
	}

	for (const img of images) {
		if (!(img instanceof File)) {
			throw error(400, 'Imagine invalidă');
		}
		if (img.size === 0) {
			throw error(400, `Imaginea "${img.name}" nu poate fi goală`);
		}
		if (!ALLOWED_IMAGE_TYPES.includes(img.type)) {
			throw error(400, `Imaginea "${img.name}" are un tip neacceptat. Acceptăm: JPG, PNG, GIF, WebP`);
		}
		if (img.size > MAX_IMAGE_SIZE) {
			throw error(400, `Imaginea "${img.name}" depășește dimensiunea maximă de ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
		}
		const validImgBytes = await validateMagicBytes(img);
		if (!validImgBytes) {
			throw error(400, `Imaginea "${img.name}" nu corespunde tipului declarat`);
		}
	}

	// Upload document to MinIO
	const docUpload = await storage.uploadFile(tenantId, file, {
		type: 'marketing',
		clientId,
		category
	});

	// Upload images to MinIO and collect metadata (with cleanup on failure)
	interface AttachedImage {
		filePath: string;
		fileName: string;
		fileSize: number;
		mimeType: string;
		dimensions: string | null;
	}

	const attachedImages: AttachedImage[] = [];
	try {
		for (const img of images) {
			const imgUpload = await storage.uploadFile(tenantId, img, {
				type: 'marketing',
				clientId,
				category
			});

			let dimensions: string | null = null;
			const dims = await getImageDimensions(img);
			if (dims) {
				dimensions = `${dims.w}x${dims.h}`;
			}

			attachedImages.push({
				filePath: imgUpload.path,
				fileName: img.name,
				fileSize: imgUpload.size,
				mimeType: imgUpload.mimeType,
				dimensions
			});
		}
	} catch (uploadErr) {
		// Cleanup: delete doc + any already-uploaded images
		const filesToClean = [docUpload.path, ...attachedImages.map((i) => i.filePath)];
		for (const fp of filesToClean) {
			try { await storage.deleteFile(fp); } catch { /* best effort */ }
		}
		throw error(500, 'Eroare la încărcarea imaginilor. Fișierele au fost curățate.');
	}

	const materialId = generateMaterialId();

	try {
		await db.insert(table.marketingMaterial).values({
			id: materialId,
			tenantId,
			clientId,
			category,
			type: 'document',
			title,
			description,
			filePath: docUpload.path,
			fileSize: docUpload.size,
			mimeType: docUpload.mimeType,
			fileName: file.name,
			attachedImages: attachedImages.length > 0 ? JSON.stringify(attachedImages) : null,
			status: 'active',
			uploadedByUserId: isClientUser ? null : userId,
			uploadedByClientUserId: clientUserId || null,
			tags
		});
	} catch (dbErr) {
		// Cleanup orphan files from storage
		const filesToClean = [docUpload.path, ...attachedImages.map((i) => i.filePath)];
		for (const fp of filesToClean) {
			try { await storage.deleteFile(fp); } catch { /* best effort */ }
		}
		throw dbErr;
	}

	return json({ success: true, materialId });
}
