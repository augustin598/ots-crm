import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { loadSiteAndClient } from '$lib/server/wordpress/site-client';
import { WpError } from '$lib/server/wordpress/errors';
import { supportsChunkedBackup } from '$lib/server/wordpress/backup-jobs';
import { advanceBackup } from '$lib/server/wordpress/backup-runner';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * POST — start a full backup (SQL + wp-content) and track it in
 * `wordpress_backup`.
 *
 * Connector ≥ 0.8.0: chunked. Creates (or resumes) the job, runs steps for
 * up to ~20 s and answers `{ backupId, status: 'running' | 'success' }`;
 * the browser continues with `POST backups/[backupId]/step` until done.
 * Older connectors: one synchronous call (fails on most shared hosts once
 * the site is big — the reason the chunked flow exists).
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params, request } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);
	const userId = locals.user.id;

	const body = (await request.json().catch(() => ({}))) as { trigger?: string };
	const trigger = body.trigger === 'pre_update' ? 'pre_update' : 'manual';

	const ctx = await loadSiteAndClient(params.siteId, locals.tenant.id);
	if (!ctx) return json({ error: 'Nu a fost găsit' }, { status: 404 });
	const { site, client } = ctx;

	if (supportsChunkedBackup(site.connectorVersion)) {
		let start;
		try {
			start = await client.backupStart({ siteId: site.id });
		} catch (err) {
			const { message } = serializeError(err);
			const code = WpError.isWpError(err) ? err.code : 'unknown_error';
			const now = new Date();
			const backupId = newId();
			await db.insert(table.wordpressBackup).values({
				id: backupId,
				tenantId: site.tenantId,
				siteId: site.id,
				userId,
				trigger,
				status: 'failed',
				error: `${code}: ${message}`.slice(0, 500),
				startedAt: now,
				finishedAt: now,
				createdAt: now
			});
			logWarning('wordpress', `Backup start failed for ${site.siteUrl}: ${code}`, {
				tenantId: site.tenantId,
				userId,
				metadata: { siteId: site.id, backupId, code }
			});
			return json({ backupId, status: 'failed', error: message }, { status: 502 });
		}

		// A job left running (tab closed, lost response) is resumed, not duplicated.
		let backupId: string | null = null;
		if (start.resumed) {
			const [existing] = await db
				.select({ id: table.wordpressBackup.id })
				.from(table.wordpressBackup)
				.where(
					and(
						eq(table.wordpressBackup.siteId, site.id),
						eq(table.wordpressBackup.archivePath, start.backup)
					)
				)
				.limit(1);
			if (existing) {
				backupId = existing.id;
				await db
					.update(table.wordpressBackup)
					.set({ status: 'running', error: null, finishedAt: null })
					.where(eq(table.wordpressBackup.id, backupId));
			}
		}
		if (!backupId) {
			backupId = newId();
			const now = new Date();
			await db.insert(table.wordpressBackup).values({
				id: backupId,
				tenantId: site.tenantId,
				siteId: site.id,
				userId,
				trigger,
				status: 'running',
				archivePath: start.backup,
				startedAt: now,
				createdAt: now
			});
		}

		const result = await advanceBackup({ client, site, backupId, backupName: start.backup, userId });
		return json(
			{ backupId, resumed: !!start.resumed, ...result },
			{ status: result.status === 'failed' ? 502 : 200 }
		);
	}

	// ── Legacy connector (< 0.8.0): one synchronous request ──
	const backupId = newId();
	const startedAt = new Date();

	await db.insert(table.wordpressBackup).values({
		id: backupId,
		tenantId: site.tenantId,
		siteId: site.id,
		userId,
		trigger,
		status: 'running',
		startedAt,
		createdAt: startedAt
	});

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
			userId,
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
			userId,
			metadata: { siteId: site.id, backupId, code }
		});

		const hint =
			code === 'wp_site_down' || code === 'wp_auth_error'
				? ' Hostingul a întrerupt cererea lungă; actualizează OTS Connector la 0.8.0+ pentru backup pe pași.'
				: '';
		return json({ backupId, status: 'failed', error: message + hint }, { status: 502 });
	}
};
