import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedToken } from './auth';
import { listBusinessAdAccounts } from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';

export function mapMetaStatusToPayment(
	accountStatus: number,
	disableReason: number,
): PaymentStatusSnapshot['paymentStatus'] {
	if (disableReason === 3) return 'payment_failed';
	if (disableReason === 5) return 'suspended';

	switch (accountStatus) {
		case 1:
			return 'ok';
		case 2:
			return 'suspended';
		case 3:
			return 'payment_failed';
		case 7:
			return 'risk_review';
		case 8:
			return 'payment_failed';
		case 9:
			return 'grace_period';
		case 100:
			return 'suspended';
		case 101:
			return 'closed';
		default:
			return 'ok';
	}
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
