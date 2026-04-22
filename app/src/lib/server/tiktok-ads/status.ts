import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { getAuthenticatedToken } from './auth';
import {
	fetchAdvertiserStatuses,
	fetchAdvertiserBalances,
	fetchAdvertiserCampaignHealth,
	type TiktokAdvertiserDeliveryHealth,
} from './client';
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

	// Only poll accounts assigned to a client. Saves one /advertiser/info/
	// batch + N /balance/get/ calls for orphan advertisers we don't use.
	const stored = (
		await db
			.select()
			.from(table.tiktokAdsAccount)
			.where(
				and(
					eq(table.tiktokAdsAccount.tenantId, integration.tenantId),
					eq(table.tiktokAdsAccount.integrationId, integration.id),
				),
			)
	).filter((row) => row.clientId != null);

	if (stored.length === 0) return [];

	const advertiserIds = stored.map((row) => row.tiktokAdvertiserId);
	const [info, balanceMap] = await Promise.all([
		fetchAdvertiserStatuses(advertiserIds, auth.accessToken),
		fetchAdvertiserBalances(advertiserIds, auth.accessToken),
	]);
	const infoById = new Map(info.map((i) => [i.advertiserId, i]));

	// Delivery health check — only for advertisers that APPEAR healthy at the
	// status level. Catches the "account is ENABLE but campaigns aren't
	// delivering" case (budget exhausted, audit denied, etc.) that the
	// /advertiser/info/ endpoint doesn't surface.
	const enabledAdvertiserIds = info
		.filter((i) => i.status === 'STATUS_ENABLE')
		.map((i) => i.advertiserId);

	const healthResults = await Promise.all(
		enabledAdvertiserIds.map((id) => fetchAdvertiserCampaignHealth(id, auth.accessToken)),
	);
	const healthByAdvertiser = new Map(healthResults.map((h) => [h.advertiserId, h]));

	const snapshots: PaymentStatusSnapshot[] = [];
	const checkedAt = new Date();

	for (const row of stored) {
		const adv = infoById.get(row.tiktokAdvertiserId);
		if (!adv) continue;

		const balance = balanceMap.get(row.tiktokAdvertiserId);

		let paymentStatus = mapTikTokStatusToPayment(adv.status);
		let rawStatusCode: string = adv.status;
		let rawDisableReason: string | null = null;

		// Override when advertiser is enabled but campaigns aren't delivering.
		// 'all_paused' means user chose to pause — no alert. 'budget_exceeded'
		// or 'no_delivery' are platform-level blocks worth surfacing.
		if (paymentStatus === 'ok') {
			const health = healthByAdvertiser.get(row.tiktokAdvertiserId);
			if (health && (health.issue === 'budget_exceeded' || health.issue === 'no_delivery')) {
				paymentStatus = 'risk_review';
				rawDisableReason = health.issue;
			}
		}

		snapshots.push({
			provider: 'tiktok',
			integrationId: integration.id,
			accountTableId: row.id,
			externalAccountId: row.tiktokAdvertiserId,
			clientId: row.clientId ?? null,
			accountName: adv.accountName || row.accountName || row.tiktokAdvertiserId,
			paymentStatus,
			rawStatusCode,
			rawDisableReason,
			balanceCents: balance?.balanceCents ?? null,
			currencyCode: balance?.currencyCode ?? null,
			checkedAt,
		});
	}

	return snapshots;
}
