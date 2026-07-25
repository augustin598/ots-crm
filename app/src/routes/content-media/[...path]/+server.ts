import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import * as storage from '$lib/server/storage';

const EXT_MIME: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif'
};
// tenantId/uuid.ext — restricts this public route to content images only; it can
// never be used to read arbitrary (private) tenant objects outside content-media/.
const KEY_RE = /^[a-z0-9_-]+\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/;

export const GET: RequestHandler = async ({ params }) => {
	const path = params.path;
	if (!path || path.includes('..') || !KEY_RE.test(path)) throw error(404, 'Not found');

	const ext = path.split('.').pop()!.toLowerCase();
	let buf: Buffer;
	try {
		buf = await storage.getFileBuffer(`content-media/${path}`);
	} catch {
		throw error(404, 'Not found');
	}

	return new Response(new Uint8Array(buf), {
		headers: {
			'Content-Type': EXT_MIME[ext] || 'application/octet-stream',
			'Cache-Control': 'public, max-age=31536000, immutable',
			'Content-Length': String(buf.length)
		}
	});
};
