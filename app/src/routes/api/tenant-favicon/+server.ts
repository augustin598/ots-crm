import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get('slug');
	if (!slug) throw error(400, 'Missing slug');

	const [tenant] = await db
		.select({ favicon: table.tenant.favicon })
		.from(table.tenant)
		.where(eq(table.tenant.slug, slug))
		.limit(1);

	if (!tenant?.favicon) throw error(404, 'No favicon');

	// favicon is stored as data:image/...;base64,...
	const match = tenant.favicon.match(/^data:image\/(png|x-icon|svg\+xml|ico|jpeg|gif|webp);base64,(.+)$/);
	if (!match) throw error(400, 'Invalid favicon format');

	const mimeType = `image/${match[1]}`;
	const buffer = Buffer.from(match[2], 'base64');

	return new Response(buffer, {
		headers: {
			'Content-Type': mimeType,
			'Cache-Control': 'public, max-age=3600',
			'Content-Length': String(buffer.length)
		}
	});
};
