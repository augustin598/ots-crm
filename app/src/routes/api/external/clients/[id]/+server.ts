import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * GET /api/external/clients/[id]
 *
 * Direct lookup by client id — used by workers (e.g. ads_campaign_creator) that
 * already hold a client id and need its display name for prompt context. Returns
 * 404 when the id does not belong to the caller's tenant.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'clients:read', async (event, ctx) => {
		const { id } = event.params;
		if (!id) {
			return { status: 400, body: { error: 'missing_id', message: 'id is required' } };
		}

		const [row] = await db
			.select({
				id: table.client.id,
				name: table.client.name,
				businessName: table.client.businessName,
				cui: table.client.cui,
				email: table.client.email,
				status: table.client.status
			})
			.from(table.client)
			.where(and(eq(table.client.id, id), eq(table.client.tenantId, ctx.tenantId)))
			.limit(1);

		if (!row) {
			return { status: 404, body: { error: 'not_found', message: 'Client not found' } };
		}
		return { status: 200, body: row };
	});
