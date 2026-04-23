import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

async function loadSiteForTenant(siteId: string, tenantId: string) {
	const [site] = await db
		.select()
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.id, siteId),
				eq(table.wordpressSite.tenantId, tenantId)
			)
		)
		.limit(1);
	return site;
}

/** GET — full detail for a single site (including joined client name). */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const [site] = await db
		.select({
			id: table.wordpressSite.id,
			name: table.wordpressSite.name,
			siteUrl: table.wordpressSite.siteUrl,
			status: table.wordpressSite.status,
			uptimeStatus: table.wordpressSite.uptimeStatus,
			connectorVersion: table.wordpressSite.connectorVersion,
			wpVersion: table.wordpressSite.wpVersion,
			phpVersion: table.wordpressSite.phpVersion,
			sslExpiresAt: table.wordpressSite.sslExpiresAt,
			lastHealthCheckAt: table.wordpressSite.lastHealthCheckAt,
			lastUptimePingAt: table.wordpressSite.lastUptimePingAt,
			lastError: table.wordpressSite.lastError,
			consecutiveFailures: table.wordpressSite.consecutiveFailures,
			clientId: table.wordpressSite.clientId,
			clientName: table.client.name,
			createdAt: table.wordpressSite.createdAt,
			updatedAt: table.wordpressSite.updatedAt
		})
		.from(table.wordpressSite)
		.leftJoin(table.client, eq(table.client.id, table.wordpressSite.clientId))
		.where(
			and(
				eq(table.wordpressSite.id, params.siteId),
				eq(table.wordpressSite.tenantId, locals.tenant.id)
			)
		)
		.limit(1);

	if (!site) {
		return json({ error: 'Nu a fost găsit' }, { status: 404 });
	}

	return json({ site });
};

/** PATCH — update mutable fields (name, clientId). Secret rotation is a
 * separate endpoint (/rotate-secret) to keep the surface area explicit. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const site = await loadSiteForTenant(params.siteId, locals.tenant.id);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	const body = (await request.json().catch(() => null)) as {
		name?: string;
		clientId?: string | null;
	} | null;
	if (!body) return json({ error: 'Body invalid' }, { status: 400 });

	const patch: Partial<typeof table.wordpressSite.$inferInsert> = {
		updatedAt: new Date()
	};

	if (typeof body.name === 'string' && body.name.trim().length > 0) {
		patch.name = body.name.trim();
	}

	if (body.clientId !== undefined) {
		if (body.clientId === null) {
			patch.clientId = null;
		} else {
			// Validate the client belongs to this tenant before assigning.
			const [client] = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(
					and(
						eq(table.client.id, body.clientId),
						eq(table.client.tenantId, locals.tenant.id)
					)
				)
				.limit(1);
			if (!client) return json({ error: 'Client invalid' }, { status: 400 });
			patch.clientId = body.clientId;
		}
	}

	await db
		.update(table.wordpressSite)
		.set(patch)
		.where(eq(table.wordpressSite.id, site.id));

	return json({ success: true });
};

/** DELETE — removes the site from the CRM. Does NOT touch the WordPress
 * install itself; the plugin continues running there until the user removes
 * it manually. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const site = await loadSiteForTenant(params.siteId, locals.tenant.id);
	if (!site) return json({ error: 'Nu a fost găsit' }, { status: 404 });

	await db.delete(table.wordpressSite).where(eq(table.wordpressSite.id, site.id));

	return json({ success: true });
};
