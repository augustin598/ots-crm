import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { WpClient } from '$lib/server/wordpress/client';
import { WpError } from '$lib/server/wordpress/errors';
import { syncUpdates } from '$lib/server/wordpress/sync';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

type ApplyItem = { type: 'core' | 'plugin' | 'theme'; slug: string };

function isValidItem(x: unknown): x is ApplyItem {
	if (!x || typeof x !== 'object') return false;
	const o = x as Record<string, unknown>;
	return (
		(o.type === 'core' || o.type === 'plugin' || o.type === 'theme') &&
		typeof o.slug === 'string' &&
		o.slug.length > 0
	);
}

/**
 * POST — apply the given updates on the WordPress site. Creates a
 * `wordpress_update_job` row up front so the audit trail survives a
 * mid-batch network failure. Blocks until the plugin replies (~3 min
 * budget per batch), then re-syncs the pending-updates cache.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
	const rawItems = Array.isArray(body?.items) ? body?.items : [];
	const items = rawItems.filter(isValidItem);
	if (items.length === 0) {
		return json({ error: 'Lista de update-uri este goală' }, { status: 400 });
	}

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

	// Decrypt, retrying once on the Turso truncated-read pattern.
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

	const jobId = newId();
	const startedAt = new Date();

	await db.insert(table.wordpressUpdateJob).values({
		id: jobId,
		tenantId: site.tenantId,
		siteId: site.id,
		userId: locals.user.id,
		items: JSON.stringify(items),
		status: 'running',
		startedAt,
		createdAt: startedAt
	});

	const client = new WpClient(site.siteUrl, secret);

	try {
		const applyResult = await client.applyUpdates(items, { siteId: site.id });
		const finishedAt = new Date();

		const status = applyResult.success
			? 'success'
			: applyResult.items.some((i) => i.success)
				? 'partial'
				: 'failed';

		await db
			.update(table.wordpressUpdateJob)
			.set({
				status,
				result: JSON.stringify(applyResult.items),
				finishedAt
			})
			.where(eq(table.wordpressUpdateJob.id, jobId));

		logInfo('wordpress', `Applied ${items.length} update(s) to ${site.siteUrl} — ${status}`, {
			tenantId: site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: site.id, jobId, items: items.length, status }
		});

		// Refresh the cached pending-updates so the UI reflects reality.
		// Failure here is non-fatal — user will see stale cache until next cron.
		syncUpdates(site.id).catch(() => undefined);

		return json({
			jobId,
			status,
			items: applyResult.items,
			success: applyResult.success
		});
	} catch (err) {
		const { message } = serializeError(err);
		const code = WpError.isWpError(err) ? err.code : 'unknown_error';

		await db
			.update(table.wordpressUpdateJob)
			.set({
				status: 'failed',
				error: `${code}: ${message}`.slice(0, 500),
				finishedAt: new Date()
			})
			.where(eq(table.wordpressUpdateJob.id, jobId));

		logWarning('wordpress', `Apply-updates failed for ${site.siteUrl}: ${code}`, {
			tenantId: site.tenantId,
			userId: locals.user.id,
			metadata: { siteId: site.id, jobId, code }
		});

		return json({ jobId, status: 'failed', error: message }, { status: 502 });
	}
};
