import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { encryptVerified } from '$lib/server/plugins/smartbill/crypto';
import { generateSecret } from '$lib/server/wordpress/hmac';
import { normalizeSiteUrl } from '$lib/server/wordpress/url';
import { syncHealth } from '$lib/server/wordpress/sync';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * GET — list all WordPress sites for the current tenant, with joined
 * client name for display. Ordered by creation date (newest first).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const sites = await db
		.select({
			id: table.wordpressSite.id,
			name: table.wordpressSite.name,
			siteUrl: table.wordpressSite.siteUrl,
			status: table.wordpressSite.status,
			uptimeStatus: table.wordpressSite.uptimeStatus,
			wpVersion: table.wordpressSite.wpVersion,
			phpVersion: table.wordpressSite.phpVersion,
			lastHealthCheckAt: table.wordpressSite.lastHealthCheckAt,
			lastUptimePingAt: table.wordpressSite.lastUptimePingAt,
			lastUpdatesCheckAt: table.wordpressSite.lastUpdatesCheckAt,
			lastError: table.wordpressSite.lastError,
			clientId: table.wordpressSite.clientId,
			clientName: table.client.name,
			createdAt: table.wordpressSite.createdAt
		})
		.from(table.wordpressSite)
		.leftJoin(table.client, eq(table.client.id, table.wordpressSite.clientId))
		.where(eq(table.wordpressSite.tenantId, locals.tenant.id))
		.orderBy(desc(table.wordpressSite.createdAt));

	// Counts per site for the dashboard badges. One query instead of N+1 —
	// group by site + type, then aggregate in JS.
	const updateRows = await db
		.select({
			siteId: table.wordpressPendingUpdate.siteId,
			type: table.wordpressPendingUpdate.type,
			securityUpdate: table.wordpressPendingUpdate.securityUpdate,
			count: sql<number>`count(*)`
		})
		.from(table.wordpressPendingUpdate)
		.where(eq(table.wordpressPendingUpdate.tenantId, locals.tenant.id))
		.groupBy(
			table.wordpressPendingUpdate.siteId,
			table.wordpressPendingUpdate.type,
			table.wordpressPendingUpdate.securityUpdate
		);

	const countsBySite = new Map<
		string,
		{ core: number; plugins: number; themes: number; security: number; total: number }
	>();
	for (const row of updateRows) {
		const current = countsBySite.get(row.siteId) ?? {
			core: 0,
			plugins: 0,
			themes: 0,
			security: 0,
			total: 0
		};
		if (row.type === 'core') current.core += Number(row.count);
		else if (row.type === 'plugin') current.plugins += Number(row.count);
		else if (row.type === 'theme') current.themes += Number(row.count);
		current.total += Number(row.count);
		if (row.securityUpdate) current.security += Number(row.count);
		countsBySite.set(row.siteId, current);
	}

	const sitesWithCounts = sites.map((s) => ({
		...s,
		updates: countsBySite.get(s.id) ?? { core: 0, plugins: 0, themes: 0, security: 0, total: 0 }
	}));

	return json({ sites: sitesWithCounts });
};

/**
 * POST — create a new WordPress site. Either `secretKey` is provided
 * (user pasted the secret shown by the plugin at install), or the server
 * generates one that the user then copies into the plugin UI.
 *
 * After insert, attempts one health check synchronously so the user sees
 * immediate feedback in the UI.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as {
		name?: string;
		siteUrl?: string;
		secretKey?: string;
		clientId?: string | null;
	} | null;

	if (!body || !body.name || !body.siteUrl) {
		return json({ error: 'name și siteUrl sunt obligatorii' }, { status: 400 });
	}

	let normalizedUrl: string;
	try {
		normalizedUrl = normalizeSiteUrl(body.siteUrl);
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'siteUrl invalid' },
			{ status: 400 }
		);
	}

	// Reject duplicates for the same tenant.
	const [existing] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(
			and(
				eq(table.wordpressSite.tenantId, locals.tenant.id),
				eq(table.wordpressSite.siteUrl, normalizedUrl)
			)
		)
		.limit(1);
	if (existing) {
		return json({ error: 'Site-ul e deja adăugat' }, { status: 409 });
	}

	// Validate clientId belongs to the same tenant if provided.
	if (body.clientId) {
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
		if (!client) {
			return json({ error: 'Client invalid' }, { status: 400 });
		}
	}

	const rawSecret = body.secretKey?.trim() || generateSecret();
	const encryptedSecret = encryptVerified(locals.tenant.id, rawSecret);

	const id = newId();
	const now = new Date();

	await db.insert(table.wordpressSite).values({
		id,
		tenantId: locals.tenant.id,
		clientId: body.clientId ?? null,
		name: body.name.trim(),
		siteUrl: normalizedUrl,
		secretKey: encryptedSecret,
		status: 'pending',
		uptimeStatus: 'unknown',
		consecutiveFailures: 0,
		createdAt: now,
		updatedAt: now
	});

	// Fire an initial health check so the UI shows real status on reload.
	// Swallow failure — the user will see the error state on the list.
	syncHealth(id).catch(() => undefined);

	return json(
		{
			id,
			// Return the raw secret ONLY when we generated it, so the user
			// can copy it into the plugin. When they supplied it themselves,
			// we never echo it back.
			secret: body.secretKey ? undefined : rawSecret
		},
		{ status: 201 }
	);
};
