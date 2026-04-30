import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, like, or, desc } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * Lightweight client search for the WhatsApp/email triage worker. Used to
 * resolve a free-text "client hint" to a single CRM client before spawning
 * an ads_campaign_creator child worker.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'clients:read', async (event, ctx) => {
		const search = (event.url.searchParams.get('search') ?? '').trim();
		const limitRaw = parseInt(event.url.searchParams.get('limit') ?? '10', 10);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

		const conditions = [eq(table.client.tenantId, ctx.tenantId)];
		if (search) {
			const pattern = `%${search}%`;
			conditions.push(
				or(
					like(table.client.name, pattern),
					like(table.client.businessName, pattern),
					like(table.client.cui, pattern),
					like(table.client.email, pattern)
				)!
			);
		}

		const rows = await db
			.select({
				id: table.client.id,
				name: table.client.name,
				businessName: table.client.businessName,
				cui: table.client.cui,
				email: table.client.email,
				status: table.client.status
			})
			.from(table.client)
			.where(and(...conditions))
			.orderBy(desc(table.client.id))
			.limit(limit);

		return {
			status: 200,
			body: { items: rows, total: rows.length, query: { search, limit } }
		};
	});
