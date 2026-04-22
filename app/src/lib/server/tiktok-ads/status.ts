import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { getAuthenticatedToken } from './auth';
import { fetchAdvertiserStatuses } from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';

export function mapTikTokStatusToPayment(status: string): PaymentStatusSnapshot['paymentStatus'] {
	switch (status) {
		case 'STATUS_ENABLE':
			return 'ok';
		case 'STATUS_CBD_DISABLE':
			return 'payment_failed';
		case 'STATUS_DISABLE':
		case 'STATUS_PUNISH':
		case 'STATUS_PUNISH_END_ADS':
			return 'suspended';
		case 'STATUS_CBT_ACCOUNT_CLOSED':
			return 'closed';
		case 'STATUS_CONTRACT_PENDING':
		case 'STATUS_CONFIRM_FAIL':
		case 'STATUS_WAIT_FOR_PUBLIC_AUTHORIZE':
			return 'risk_review';
		default:
			logWarning('tiktok-ads', 'Unknown TikTok advertiser status; treating as risk_review', {
				metadata: { status },
			});
			return 'risk_review';
	}
}

export async function fetchTikTokPaymentStatus(
	integration: typeof table.tiktokAdsIntegration.$inferSelect,
): Promise<PaymentStatusSnapshot[]> {
	const auth = await getAuthenticatedToken(integration.id);
	if (!auth) return [];

	const stored = await db
		.select()
		.from(table.tiktokAdsAccount)
		.where(
			and(
				eq(table.tiktokAdsAccount.tenantId, integration.tenantId),
				eq(table.tiktokAdsAccount.integrationId, integration.id),
			),
		);

	if (stored.length === 0) return [];

	const advertiserIds = stored.map((row) => row.tiktokAdvertiserId);
	const info = await fetchAdvertiserStatuses(advertiserIds, auth.accessToken);
	const infoById = new Map(info.map((i) => [i.advertiserId, i]));

	const snapshots: PaymentStatusSnapshot[] = [];
	const checkedAt = new Date();

	for (const row of stored) {
		const adv = infoById.get(row.tiktokAdvertiserId);
		if (!adv) continue;

		snapshots.push({
			provider: 'tiktok',
			integrationId: integration.id,
			accountTableId: row.id,
			externalAccountId: row.tiktokAdvertiserId,
			clientId: row.clientId ?? null,
			accountName: adv.accountName || row.accountName || row.tiktokAdvertiserId,
			paymentStatus: mapTikTokStatusToPayment(adv.status),
			rawStatusCode: adv.status,
			rawDisableReason: null,
			checkedAt,
		});
	}

	return snapshots;
}
