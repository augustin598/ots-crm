import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type HealthStatus = 'healthy' | 'expiring_soon' | 'expired' | 'broken' | 'inactive';

interface IntegrationHealth {
	platform: 'meta' | 'tiktok' | 'google';
	integrationId: string;
	tokenExpiresAt: Date | null;
	daysUntilExpiry: number | null;
	status: HealthStatus;
	lastSyncAt: Date | null;
	lastError: string | null;
}

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

		const items: IntegrationHealth[] = [];

		for (const r of metaRows) {
			items.push(
				buildHealth('meta', r.id, r.tokenExpiresAt, r.lastSyncAt, r.lastRefreshError, r.isActive, now)
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
					now
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
					now
				)
			);
		}

		return { status: 200, body: { items, total: items.length } };
	});

function buildHealth(
	platform: 'meta' | 'tiktok' | 'google',
	integrationId: string,
	tokenExpiresAt: Date | null,
	lastSyncAt: Date | null,
	lastError: string | null,
	isActive: boolean,
	now: number
): IntegrationHealth {
	let status: HealthStatus = 'healthy';
	let daysUntilExpiry: number | null = null;

	if (!isActive) {
		status = 'inactive';
	} else if (tokenExpiresAt) {
		const ms = tokenExpiresAt.getTime() - now;
		daysUntilExpiry = Math.floor(ms / (24 * 60 * 60 * 1000));
		if (ms < 0) status = 'expired';
		else if (ms < SEVEN_DAYS_MS) status = 'expiring_soon';
	} else if (lastError) {
		status = 'broken';
	}

	return {
		platform,
		integrationId,
		tokenExpiresAt,
		daysUntilExpiry,
		status,
		lastSyncAt,
		lastError
	};
}
