import type { RequestEvent } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import * as storage from '$lib/server/storage';

const TYPE_EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};
const EXT_MIME: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif'
};
const MAX_UPLOAD = 8 * 1024 * 1024; // 8MB
const MAX_SIDELOAD = 12 * 1024 * 1024; // 12MB — guard against pushing a huge remote image to WP

/** Confirm the declared image type matches the file's leading bytes. */
async function validImageMagic(file: File): Promise<boolean> {
	const h = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	switch (file.type) {
		case 'image/jpeg':
			return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
		case 'image/png':
			return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
		case 'image/gif':
			return h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46;
		case 'image/webp':
			return (
				h[0] === 0x52 &&
				h[1] === 0x49 &&
				h[2] === 0x46 &&
				h[3] === 0x46 &&
				h[8] === 0x57 &&
				h[9] === 0x45 &&
				h[10] === 0x42 &&
				h[11] === 0x50
			);
		default:
			return false;
	}
}

/**
 * Upload a featured/body image for a content article. Auth mirrors the marketing
 * upload gate: must be a client user of this tenant OR a tenantUser of this tenant
 * (event.locals.tenant comes from the URL alone, so the membership check is required).
 * Returns { url } — a stable, non-expiring public path under /content-media/.
 */
export async function handleContentImageUpload(event: RequestEvent): Promise<Response> {
	const tenantId = event.locals.tenant?.id;
	const userId = event.locals.user?.id;
	if (!userId || !tenantId) throw error(401, 'Unauthorized');
	if (!event.locals.isClientUser && !event.locals.tenantUser)
		throw error(403, 'Acces interzis pentru acest tenant');
	if (event.locals.isClientUser && !event.locals.client) throw error(403, 'Sesiune client invalidă');

	const form = await event.request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) throw error(400, 'Fișierul este obligatoriu');

	const ext = TYPE_EXT[file.type];
	if (!ext) throw error(400, 'Tip de fișier neacceptat. Acceptăm: JPG, PNG, WebP, GIF');
	if (file.size === 0) throw error(400, 'Fișierul nu poate fi gol');
	if (file.size > MAX_UPLOAD) throw error(400, `Imaginea depășește ${MAX_UPLOAD / (1024 * 1024)}MB`);
	if (!(await validImageMagic(file))) throw error(400, 'Fișierul nu corespunde tipului declarat');

	const buffer = Buffer.from(await file.arrayBuffer());
	const { key } = await storage.uploadContentImage(tenantId, buffer, ext, file.type);
	return json({ url: `/${key}` }); // /content-media/<tenantId>/<uuid>.<ext>
}

/**
 * Resolve a featured-image URL to bytes for a WordPress media sideload. Our own
 * content-media URLs are read straight from MinIO (no HTTP round-trip, no expiry),
 * while external URLs (e.g. og:image scraped from the source site) are fetched.
 * Returns null when the URL can't be resolved as a supported image.
 */
export async function resolveFeaturedImage(
	url: string
): Promise<{ dataBase64: string; mimeType: string; filename: string } | null> {
	if (!url) return null;

	if (url.startsWith('/content-media/')) {
		const buf = await storage.getFileBuffer(url.slice(1));
		if (buf.length === 0 || buf.length > MAX_SIDELOAD) return null;
		const ext = (url.split('.').pop() || 'jpg').toLowerCase();
		return {
			dataBase64: buf.toString('base64'),
			mimeType: EXT_MIME[ext] || 'image/jpeg',
			filename: `featured-${Date.now()}.${ext}`
		};
	}

	if (/^https?:\/\//i.test(url)) {
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
		if (!res.ok) return null;
		const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		const ext = Object.entries(EXT_MIME).find(([, m]) => m === ct)?.[0];
		if (!ext) return null; // not a supported image type
		const ab = await res.arrayBuffer();
		if (ab.byteLength === 0 || ab.byteLength > MAX_SIDELOAD) return null;
		return {
			dataBase64: Buffer.from(ab).toString('base64'),
			mimeType: ct,
			filename: `featured-${Date.now()}.${ext}`
		};
	}

	return null;
}
