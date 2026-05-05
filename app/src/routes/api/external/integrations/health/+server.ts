import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { buildHealth } from './health.utils';

/**
 * Health snapshot for all advertising integrations on this tenant.
 * Used by the PersonalOPS scheduler to alert on tokens nearing expiry.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'integrations:read', async (event, ctx) => {
		const now = Date.now();

		const metaRows = await db
			.select()
			.from(table.metaAdsIntegration)
			.where(eq(table.metaAdsIntegration.tenantId, ctx.tenantId));

		const tiktokRows = await db
			.select()
			.from(table.tiktokAdsIntegration)
			.where(eq(table.tiktokAdsIntegration.tenantId, ctx.tenantId));

		const googleRows = await db
			.select()
			.from(table.googleAdsIntegration)
			.where(eq(table.googleAdsIntegration.tenantId, ctx.tenantId));

		const items = [];

		for (const r of metaRows) {
			items.push(
				buildHealth('meta', r.id, r.tokenExpiresAt, r.lastSyncAt, r.lastRefreshError, r.isActive, now, r.consecutiveRefreshFailures ?? 0)
			);
		}
		for (const r of tiktokRows) {
			items.push(
				buildHealth(
					'tiktok',
					r.id,
					r.tokenExpiresAt,
					r.lastSyncAt,
					r.lastRefreshError,
					r.isActive,
					now,
					r.consecutiveRefreshFailures ?? 0
				)
			);
		}
		for (const r of googleRows) {
			items.push(
				buildHealth(
					'google',
					r.id,
					r.tokenExpiresAt,
					r.lastSyncAt,
					r.lastRefreshError,
					r.isActive,
					now,
					r.consecutiveRefreshFailures ?? 0
				)
			);
		}

		return { status: 200, body: { items, total: items.length } };
	});
