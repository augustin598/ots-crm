import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

async function loadBackupForTenant(backupId: string, tenantId: string) {
	const [row] = await db
		.select({
			backup: table.wordpressBackup,
			site: table.wordpressSite
		})
		.from(table.wordpressBackup)
		.innerJoin(table.wordpressSite, eq(table.wordpressSite.id, table.wordpressBackup.siteId))
		.where(
			and(
				eq(table.wordpressBackup.id, backupId),
				eq(table.wordpressBackup.tenantId, tenantId)
			)
		)
		.limit(1);
	return row;
}

/** Extract the filename portion of an archive URL/path — whatever shape the
 * plugin returned. We never want to send a full path back to the plugin; the
 * plugin validates strictly by filename pattern. */
function extractFilename(backup: typeof table.wordpressBackup.$inferSelect): string | null {
	const candidate = backup.archivePath || backup.archiveUrl;
	if (!candidate) return null;
	const parts = candidate.split('/');
	return parts[parts.length - 1] || null;
}

/**
 * DELETE — remove a backup archive from the WP server and from the CRM's
 * history. Tolerant of "already-gone" on the plugin side (idempotent).
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const row = await loadBackupForTenant(params.backupId, locals.tenant.id);
	if (!row) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const filename = extractFilename(row.backup);

	// If we have a filename + the backup is successful, try to clean up the file.
	// If the archive was never produced (failed backup) we just drop the DB row.
	if (filename && row.backup.status === 'success') {
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
		try {
			await client.deleteBackup(filename, { siteId: row.site.id });
		} catch (err) {
			const { message } = serializeError(err);
			const code = WpError.isWpError(err) ? err.code : 'unknown_error';
			logWarning('wordpress', `Backup delete failed on WP side for ${row.site.siteUrl}: ${code}`, {
				tenantId: row.site.tenantId,
				userId: locals.user.id,
				metadata: { siteId: row.site.id, backupId: params.backupId, filename, code }
			});
			// Don't bail — user wanted this gone from the UI. Report softly.
			await db.delete(table.wordpressBackup).where(eq(table.wordpressBackup.id, params.backupId));
			return json({ success: true, warning: `Șters din CRM, dar plugin-ul nu a putut șterge fișierul: ${message}` });
		}
	}

	await db.delete(table.wordpressBackup).where(eq(table.wordpressBackup.id, params.backupId));

	logInfo('wordpress', `Backup deleted from ${row.site.siteUrl}`, {
		tenantId: row.site.tenantId,
		userId: locals.user.id,
		metadata: { siteId: row.site.id, backupId: params.backupId, filename }
	});

	return json({ success: true });
};
