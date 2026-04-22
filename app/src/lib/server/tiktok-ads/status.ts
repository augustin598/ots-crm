import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { getAuthenticatedToken } from './auth';
import { fetchAdvertiserStatuses } from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';
import { mapTikTokStatusPure, isKnownTikTokStatus } from '$lib/server/ads/status-mappers';

/** Wraps the pure mapper with unknown-code logging. */
export function mapTikTokStatusToPayment(status: string): PaymentStatusSnapshot['paymentStatus'] {
	if (!isKnownTikTokStatus(status)) {
		logWarning('tiktok-ads', 'Unknown TikTok advertiser status; treating as risk_review', {
			metadata: { status },
		});
	}
	return mapTikTokStatusPure(status);
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
