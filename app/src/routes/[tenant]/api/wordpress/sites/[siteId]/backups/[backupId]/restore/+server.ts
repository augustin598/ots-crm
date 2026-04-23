import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * POST — DESTRUCTIVE: extract the backup archive on the WP server and
 * replay its SQL dump, overwriting the current DB + wp-content. The plugin
 * rejects invalid filenames (path traversal, non-backup pattern).
 *
 * UI gates this behind a typed-confirmation dialog; the backend trusts the
 * user's click but verifies the backup row belongs to the tenant.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const [row] = await db
		.select({
			backup: table.wordpressBackup,
			site: table.wordpressSite
		})
		.from(table.wordpressBackup)
		.innerJoin(table.wordpressSite, eq(table.wordpressSite.id, table.wordpressBackup.siteId))
		.where(
			and(
				eq(table.wordpressBackup.id, params.backupId),
				eq(table.wordpressBackup.tenantId, locals.tenant.id),
				eq(table.wordpressSite.id, params.siteId)
			)
		)
		.limit(1);

	if (!row) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	if (row.backup.status !== 'success') {
		return json({ error: 'Doar backup-urile reușite pot fi restaurate' }, { status: 400 });
	}

	const candidate = row.backup.archivePath || row.backup.archiveUrl;
	if (!candidate) {
		return json({ error: 'Nu există fișier pentru acest backup' }, { status: 400 });
	}
	const filename = candidate.split('/').pop() ?? '';
	if (!/^ots-backup-[0-9\-]+\.zip$/.test(filename)) {
		return json({ error: 'Nume fișier invalid' }, { status: 400 });
	}

	let secret: string;
	try {
		secret = decrypt(row.site.tenantId, row.site.secretKey);
	} catch (err) {
		if (err instanceof DecryptionError) {
			await new Promise((r) => setTimeout(r, 1000));
			const [fresh] = await db
				.select()
				.from(table.wordpressSite)
				.where(eq(table.wordpressSite.id, row.site.id))
				.limit(1);
			secret = decrypt(fresh!.tenantId, fresh!.secretKey);
		} else {
			throw err;
		}
	}

	const client = new WpClient(row.site.siteUrl, secret);

	logInfo('wordpress', `Restore STARTED for ${row.site.siteUrl} from ${filename}`, {
		tenantId: row.site.tenantId,
		userId: locals.user.id,
		metadata: { siteId: row.site.id, backupId: params.backupId, filename }
	});

	try {
		const result = await client.restoreBackup(filename, { siteId: row.site.id });

		logInfo('wordpress', `Restore OK for ${row.site.siteUrl} — ${result.tablesImported} tables in ${result.elapsedSec}s`, {
			tenantId: row.site.tenantId,
			userId: locals.user.id,
			metadata: {
				siteId: row.site.id,
				backupId: params.backupId,
				filename,
				elapsedSec: result.elapsedSec,
				tablesImported: result.tablesImported
			}
		});

		return json({
			success: true,
			elapsedSec: result.elapsedSec,
			tablesImported: result.tablesImported
		});
	} catch (err) {
		const { message, stack } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';
		logWarning('wordpress', `Restore FAILED for ${row.site.siteUrl}: ${code}`, {
			tenantId: row.site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: row.site.id, backupId: params.backupId, filename, code },
			stackTrace: stack
		});
		return json({ success: false, error: message }, { status: 502 });
	}
};
