import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/tiktok-ads/auth';
import { fetchTikTokPaymentStatus } from '$lib/server/tiktok-ads/status';
import { reconcileAndAlert } from '$lib/server/ads/payment-alerts';
import type { RequestHandler } from './$types';

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}

	const advertiserId = event.params.advertiserId!;
	const tenantId = event.locals.tenant.id;
	const shouldRefresh = event.url.searchParams.get('refresh') === '1';

	const [account] = await db
		.select()
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, tenantId),
				eq(table.tiktokAdsAccount.tiktokAdvertiserId, advertiserId)
			)
		)
		.limit(1);

	if (!account) throw error(404, 'advertiser not found for tenant');

	const auth = await getAuthenticatedToken(account.integrationId);
	if (!auth) throw error(500, 'no token');

	const before = {
		storedPaymentStatus: account.paymentStatus,
		storedPaymentStatusRaw: account.paymentStatusRaw
	};

	// Optional live refresh: runs the production reconciler path against a
	// fetched snapshot for this integration and filters to the single advertiser
	// under test. Mirrors what the scheduled monitor does, minus the BullMQ hop.
	let refreshResult: unknown = null;
	if (shouldRefresh) {
		const [integration] = await db
			.select()
			.from(table.tiktokAdsIntegration)
			.where(eq(table.tiktokAdsIntegration.id, account.integrationId))
			.limit(1);
		if (!integration) throw error(500, 'integration missing');

		const snapshots = await fetchTikTokPaymentStatus(integration);
		const relevant = snapshots.filter((s) => s.externalAccountId === advertiserId);
		refreshResult = {
			snapshots: relevant,
			reconcile:
				relevant.length > 0 ? await reconcileAndAlert(tenantId, relevant) : { note: 'no snapshot produced' }
		};
	}

	// Re-read stored state after potential refresh.
	const [afterRow] = await db
		.select({
			paymentStatus: table.tiktokAdsAccount.paymentStatus,
			paymentStatusRaw: table.tiktokAdsAccount.paymentStatusRaw
		})
		.from(table.tiktokAdsAccount)
		.where(eq(table.tiktokAdsAccount.id, account.id))
		.limit(1);

	const infoRes = await fetch(
		`${TIKTOK_API_URL}/advertiser/info/?advertiser_ids=${encodeURIComponent(JSON.stringify([advertiserId]))}`,
		{
			headers: { 'Access-Token': auth.accessToken },
			signal: AbortSignal.timeout(15_000)
		}
	);
	const info = await infoRes.json();

	const campRes = await fetch(
		`${TIKTOK_API_URL}/campaign/get/?advertiser_id=${advertiserId}&page_size=1000&fields=${encodeURIComponent(JSON.stringify(['campaign_id', 'campaign_name', 'operation_status', 'secondary_status']))}`,
		{
			headers: { 'Access-Token': auth.accessToken },
			signal: AbortSignal.timeout(15_000)
		}
	);
	const campaigns = await campRes.json();

	return json({
		before,
		after: afterRow ?? before,
		refresh: refreshResult,
		advertiserInfo: info.data?.list?.[0] ?? info,
		campaigns: campaigns.data?.list ?? campaigns
	});
};
