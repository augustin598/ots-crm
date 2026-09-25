import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { isChunkedBackupName } from '$lib/server/wordpress/backup-jobs';
import { advanceBackup, failBackup } from '$lib/server/wordpress/backup-runner';

/**
 * POST — continue a chunked backup for up to ~20 s.
 *
 * Body: `{ abandon?: true, error?: string }` — the browser gives up after
 * repeated transport failures and records why; otherwise it just steps.
 * Answers `{ status: 'running' | 'success' | 'failed', progress?, retryable? }`.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params, request } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);
	const userId = locals.user.id;

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
		return json({ error: 'Backup-ul nu e pe pași (conector vechi)' }, { status: 400 });
	}
	if (row.status !== 'running') {
		return json({ status: row.status, sizeBytes: row.sizeBytes, error: row.error });
	}

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => ({}))) as { abandon?: boolean; error?: string };
	if (body.abandon) {
		const error = `abandonat: ${body.error ?? 'prea multe erori consecutive'}`;
		await failBackup({ site: ctx.site, backupId: row.id, userId, error });
		return json({ status: 'failed', error });
	}

	const result = await advanceBackup({
		client: ctx.client,
		site: ctx.site,
		backupId: row.id,
		backupName,
		userId
	});
	return json(result, { status: result.status === 'failed' ? 502 : 200 });
};
