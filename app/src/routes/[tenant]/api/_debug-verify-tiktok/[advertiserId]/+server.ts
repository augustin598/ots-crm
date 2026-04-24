import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/tiktok-ads/auth';
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
		storedPaymentStatus: account.paymentStatus,
		storedPaymentStatusRaw: account.paymentStatusRaw,
		advertiserInfo: info.data?.list?.[0] ?? info,
		campaigns: campaigns.data?.list ?? campaigns
	});
};
