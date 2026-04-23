import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/** GET — list backups for this site, newest first. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const [site] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, params.siteId),
				eq(table.wordpressSite.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const backups = await db
		.select({
			id: table.wordpressBackup.id,
			trigger: table.wordpressBackup.trigger,
			status: table.wordpressBackup.status,
			archiveUrl: table.wordpressBackup.archiveUrl,
			sizeBytes: table.wordpressBackup.sizeBytes,
			error: table.wordpressBackup.error,
			startedAt: table.wordpressBackup.startedAt,
			finishedAt: table.wordpressBackup.finishedAt,
			createdAt: table.wordpressBackup.createdAt
		})
		.from(table.wordpressBackup)
		.where(eq(table.wordpressBackup.siteId, site.id))
		.orderBy(desc(table.wordpressBackup.createdAt))
		.limit(50);

	return json({ backups });
};
