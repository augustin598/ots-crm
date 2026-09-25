import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { WpError } from '$lib/server/wordpress/errors';
import { isChunkedBackupName, supportsChunkedBackup } from '$lib/server/wordpress/backup-jobs';
import { advanceRestore } from '$lib/server/wordpress/backup-runner';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * POST — DESTRUCTIVE: restore a backup over the current DB + wp-content.
 *
 * Chunked backups (connector ≥ 0.8.0): the connector imports the database
 * into staged tables, verifies every table's row count against the backup
 * and only then swaps them in atomically; files follow. This call runs
 * steps for ~20 s and answers `{ status: 'running' | 'success' }`; the
 * browser continues with `POST restore/step`.
 * Legacy `.zip` backups: one synchronous call, as before.
 *
 * UI gates this behind a typed-confirmation dialog; the backend verifies
 * the backup row belongs to the tenant and site.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params } = event;
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

	if (row.status !== 'success') {
		return json({ error: 'Doar backup-urile reușite pot fi restaurate' }, { status: 400 });
	}

	const candidate = row.archivePath || row.archiveUrl;
	if (!candidate) {
		return json({ error: 'Nu există fișier pentru acest backup' }, { status: 400 });
	}
	const filename = candidate.split('/').pop() ?? '';
	const chunked = isChunkedBackupName(filename);
	if (!chunked && !/^ots-backup-[0-9\-]+\.zip$/.test(filename)) {
		return json({ error: 'Nume fișier invalid' }, { status: 400 });
	}

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });
	const { site, client } = ctx;

	logInfo('wordpress', `Restore STARTED for ${site.siteUrl} from ${filename}`, {
		tenantId: site.tenantId,
		userId,
		metadata: { siteId: site.id, backupId: row.id, filename, chunked }
	});

	if (chunked) {
		if (!supportsChunkedBackup(site.connectorVersion)) {
			return json(
				{ error: 'Restaurarea acestui backup cere OTS Connector 0.8.0+ pe site' },
				{ status: 409 }
			);
		}
		try {
			await client.restoreStart(filename, { siteId: site.id });
		} catch (err) {
			const { message } = serializeError(err);
			const code = WpError.isWpError(err) ? err.code : 'unknown_error';
			logWarning('wordpress', `Restore start FAILED for ${site.siteUrl}: ${code}`, {
				tenantId: site.tenantId,
				userId,
				metadata: { siteId: site.id, backupId: row.id, filename, code, reason: message }
			});
			return json({ status: 'failed', error: message }, { status: 502 });
		}
		const result = await advanceRestore({ client, site, backupId: row.id, backupName: filename, userId });
		return json(result, { status: result.status === 'failed' ? 502 : 200 });
	}

	try {
		const result = await client.restoreBackup(filename, { siteId: site.id });

		logInfo('wordpress', `Restore OK for ${site.siteUrl} — ${result.tablesImported} tables in ${result.elapsedSec}s`, {
			tenantId: site.tenantId,
			userId,
			metadata: {
				siteId: site.id,
				backupId: row.id,
				filename,
				elapsedSec: result.elapsedSec,
				tablesImported: result.tablesImported
			}
		});

		return json({
			success: true,
			status: 'success',
			elapsedSec: result.elapsedSec,
			tablesImported: result.tablesImported
		});
	} catch (err) {
		const { message, stack } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `Restore FAILED for ${site.siteUrl}: ${code}`, {
			tenantId: site.tenantId,
			userId,
			metadata: { siteId: site.id, backupId: row.id, filename, code },
			stackTrace: stack
		});
		return json({ success: false, status: 'failed', error: message }, { status: 502 });
	}
};
