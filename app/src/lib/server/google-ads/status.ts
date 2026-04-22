import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { listMccSubAccounts, fetchBillingSetupStatus, formatCustomerId } from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';

export function mapGoogleStatusToPayment(
	customerStatus: string,
	billingSetupStatus: string | null,
): PaymentStatusSnapshot['paymentStatus'] {
	switch (customerStatus) {
		case 'SUSPENDED':
			return 'suspended';
		case 'CANCELLED':
		case 'CLOSED':
			return 'closed';
		case 'ENABLED':
			if (billingSetupStatus === 'CANCELLED') return 'payment_failed';
			if (billingSetupStatus === 'PENDING' || billingSetupStatus === 'NONE') return 'risk_review';
			return 'ok';
		default:
			logWarning('google-ads', 'Unknown Google customer status; treating as risk_review', {
				metadata: { customerStatus, billingSetupStatus },
			});
			return 'risk_review';
	}
}

export async function fetchGooglePaymentStatus(
	integration: typeof table.googleAdsIntegration.$inferSelect,
): Promise<PaymentStatusSnapshot[]> {
	const subAccounts = await listMccSubAccounts(
		integration.mccAccountId,
		integration.developerToken,
		integration.refreshToken,
	);

	// NOTE: googleAdsAccount has no integrationId column, so scoping is by
	// tenantId only. For multi-MCC tenants this could collide (tracked as a
	// follow-up: add `integration_id` column + migration).
	const stored = await db
		.select()
		.from(table.googleAdsAccount)
		.where(eq(table.googleAdsAccount.tenantId, integration.tenantId));

	const storedByCustomer = new Map(stored.map((row) => [formatCustomerId(row.googleAdsCustomerId), row]));

	const snapshots: PaymentStatusSnapshot[] = [];
	const checkedAt = new Date();

	for (const acc of subAccounts) {
		const row = storedByCustomer.get(formatCustomerId(acc.customerId));
		if (!row) continue;

		let billingSetupStatus: string | null = null;
		if (acc.status === 'ENABLED') {
			billingSetupStatus = await fetchBillingSetupStatus(
				integration.mccAccountId,
				acc.customerId,
				integration.developerToken,
				integration.refreshToken,
			);
		}

		snapshots.push({
			provider: 'google',
			integrationId: integration.id,
			accountTableId: row.id,
			externalAccountId: acc.customerId,
			clientId: row.clientId ?? null,
			accountName: acc.descriptiveName || row.accountName || acc.customerId,
			paymentStatus: mapGoogleStatusToPayment(acc.status, billingSetupStatus),
			rawStatusCode: acc.status,
			rawDisableReason: billingSetupStatus,
			checkedAt,
		});
	}

	return snapshots;
}
