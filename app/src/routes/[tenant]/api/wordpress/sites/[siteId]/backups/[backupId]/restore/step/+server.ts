import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { isChunkedBackupName } from '$lib/server/wordpress/backup-jobs';
import { advanceRestore } from '$lib/server/wordpress/backup-runner';

/** POST — continue a chunked restore for up to ~20 s. */
export const POST: RequestHandler = async (event) => {
	const { locals, params } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);

	const [row] = await db
		.select()
		.from(table.wordpressBackup)
		.where(
			and(
				eq(table.wordpressBackup.id, params.backupId),
				eq(table.wordpressBackup.tenantId, locals.tenant.id),
				eq(table.wordpressBackup.siteId, params.siteId)
			)
		)
		.limit(1);
	if (!row) return json({ error: 'Nu a fost găsit' }, { status: 404 });
	const backupName = row.archivePath ?? '';
	if (!isChunkedBackupName(backupName)) {
		return json({ error: 'Backup-ul nu e pe pași' }, { status: 400 });
	}

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const result = await advanceRestore({
		client: ctx.client,
		site: ctx.site,
		backupId: row.id,
		backupName,
		userId: locals.user.id
	});
	return json(result, { status: result.status === 'failed' ? 502 : 200 });
};
