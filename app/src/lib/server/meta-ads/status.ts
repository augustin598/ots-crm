import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { getAuthenticatedToken } from './auth';
import { listBusinessAdAccounts } from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';
import { mapMetaStatusPure, isKnownMetaAccountStatus } from '$lib/server/ads/status-mappers';

/**
 * Wraps the pure mapper with unknown-code logging.
 * See status-mappers.ts for the full enum reference.
 */
export function mapMetaStatusToPayment(
	accountStatus: number,
	disableReason: number,
): PaymentStatusSnapshot['paymentStatus'] {
	if (!isKnownMetaAccountStatus(accountStatus)) {
		logWarning('meta-ads', 'Unknown Meta account_status; treating as risk_review', {
			metadata: { accountStatus, disableReason },
		});
	}
	return mapMetaStatusPure(accountStatus, disableReason);
}

export async function fetchMetaPaymentStatus(
	integration: typeof table.metaAdsIntegration.$inferSelect,
): Promise<PaymentStatusSnapshot[]> {
	const auth = await getAuthenticatedToken(integration.id);
	if (!auth) return [];

	const accounts = await listBusinessAdAccounts(integration.businessId, auth.accessToken);

	const stored = await db
		.select()
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.tenantId, integration.tenantId),
				eq(table.metaAdsAccount.integrationId, integration.id),
			),
		);

	const storedByExternal = new Map(stored.map((row) => [row.metaAdAccountId, row]));

	const snapshots: PaymentStatusSnapshot[] = [];
	const checkedAt = new Date();

	for (const acc of accounts) {
		const row = storedByExternal.get(acc.adAccountId);
		if (!row) continue;

		snapshots.push({
			provider: 'meta',
			integrationId: integration.id,
			accountTableId: row.id,
			externalAccountId: acc.adAccountId,
			clientId: row.clientId ?? null,
			accountName: acc.accountName || row.accountName || acc.adAccountId,
			paymentStatus: mapMetaStatusToPayment(acc.accountStatus, acc.disableReason),
			rawStatusCode: acc.accountStatus,
			rawDisableReason: acc.disableReason,
			checkedAt,
		});
	}

	return snapshots;
}
