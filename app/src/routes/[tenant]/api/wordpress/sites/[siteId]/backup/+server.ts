import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * POST — trigger a full backup on the plugin side (SQL dump + wp-content
 * zip). Records a `wordpress_backup` row tracking the request; on success
 * persists the archive URL + size returned by the plugin.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { trigger?: string };
	const trigger = body.trigger === 'pre_update' ? 'pre_update' : 'manual';

	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, params.siteId),
				eq(table.wordpressSite.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	let secret: string;
	try {
		secret = decrypt(site.tenantId, site.secretKey);
	} catch (err) {
		if (err instanceof DecryptionError) {
			await new Promise((r) => setTimeout(r, 1000));
			const [fresh] = await db
				.select()
				.from(table.wordpressSite)
				.where(eq(table.wordpressSite.id, site.id))
				.limit(1);
			secret = decrypt(fresh!.tenantId, fresh!.secretKey);
		} else {
			throw err;
		}
	}

	const backupId = newId();
	const startedAt = new Date();

	await db.insert(table.wordpressBackup).values({
		id: backupId,
		tenantId: site.tenantId,
		siteId: site.id,
		userId: locals.user.id,
		trigger,
		status: 'running',
		startedAt,
		createdAt: startedAt
	});

	const client = new WpClient(site.siteUrl, secret);

	try {
		const result = await client.triggerBackup({ siteId: site.id });
		const finishedAt = new Date();

		await db
			.update(table.wordpressBackup)
			.set({
				status: 'success',
				archiveUrl: result.archiveUrl,
				archivePath: result.archivePath,
				sizeBytes: result.sizeBytes,
				finishedAt
			})
			.where(eq(table.wordpressBackup.id, backupId));

		logInfo('wordpress', `Backup OK for ${site.siteUrl} — ${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB in ${result.elapsedSec}s`, {
			tenantId: site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: site.id, backupId, sizeBytes: result.sizeBytes, elapsedSec: result.elapsedSec }
		});

		return json({
			backupId,
			status: 'success',
			archiveUrl: result.archiveUrl,
			sizeBytes: result.sizeBytes,
			elapsedSec: result.elapsedSec
		});
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';

		await db
			.update(table.wordpressBackup)
			.set({
				status: 'failed',
				error: `${code}: ${message}`.slice(0, 500),
				finishedAt: new Date()
			})
			.where(eq(table.wordpressBackup.id, backupId));

		logWarning('wordpress', `Backup failed for ${site.siteUrl}: ${code}`, {
			tenantId: site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: site.id, backupId, code }
		});

		return json({ backupId, status: 'failed', error: message }, { status: 502 });
	}
};
