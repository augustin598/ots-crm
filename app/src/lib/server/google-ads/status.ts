import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { getAuthenticatedClient } from './auth';
import { listMccSubAccounts, fetchBillingSetupStatus, fetchCustomerSuspensionReasons, formatCustomerId } from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';
import { mapGoogleStatusPure, isKnownGoogleCustomerStatus } from '$lib/server/ads/status-mappers';

/** Wraps the pure mapper with unknown-code logging. */
export function mapGoogleStatusToPayment(
	customerStatus: string,
	billingSetupStatus: string | null,
): PaymentStatusSnapshot['paymentStatus'] {
	if (!isKnownGoogleCustomerStatus(customerStatus)) {
		logWarning('google-ads', 'Unknown Google customer status; treating as risk_review', {
			metadata: { customerStatus, billingSetupStatus },
		});
	}
	return mapGoogleStatusPure(customerStatus, billingSetupStatus);
}

export async function fetchGooglePaymentStatus(
	integration: typeof table.googleAdsIntegration.$inferSelect,
): Promise<PaymentStatusSnapshot[]> {
	// Route through getAuthenticatedClient so transient refresh failures get
	// retried with backoff, and a permanently revoked refresh_token returns
	// null instead of throwing the raw "Expected OAuth 2 access token" error
	// every poll cycle.
	const auth = await getAuthenticatedClient(integration.tenantId);
	if (!auth) {
		// Permanent (revoked) or transient-after-3-retries-with-expired-token.
		// auth.ts already logged details. Returning [] keeps the scheduler quiet
		// instead of bubbling a generic Google error every 15 minutes.
		return [];
	}

	const refreshed = auth.integration;

	const subAccounts = await listMccSubAccounts(
		refreshed.mccAccountId,
		refreshed.developerToken,
		refreshed.refreshToken,
	);

	// Scope to this integration. Legacy rows inserted before migration 0166 may
	// have integrationId NULL; include them so they still get status updates
	// until the next fetchGoogleAdsAccounts run populates the column.
	const stored = await db
		.select()
		.from(table.googleAdsAccount)
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, integration.tenantId),
				or(
					eq(table.googleAdsAccount.integrationId, integration.id),
					isNull(table.googleAdsAccount.integrationId),
				),
			),
		);

	// Only poll accounts assigned to a client. MCC typically has many orphan
	// sub-accounts (78 vs 9 assigned) — skipping them saves ~70 GAQL
	// billing_setup queries per run.
	const storedByCustomer = new Map(
		stored
			.filter((row) => row.clientId != null)
			.map((row) => [formatCustomerId(row.googleAdsCustomerId), row]),
	);

	const snapshots: PaymentStatusSnapshot[] = [];
	const checkedAt = new Date();

	for (const acc of subAccounts) {
		const row = storedByCustomer.get(formatCustomerId(acc.customerId));
		if (!row) continue;

		let billingSetupStatus: string | null = null;
		let suspensionReasons: string[] = [];
		if (acc.status === 'ENABLED' || acc.status === 'SUSPENDED') {
			const [billing, reasons] = await Promise.all([
				acc.status === 'ENABLED'
					? fetchBillingSetupStatus(
							refreshed.mccAccountId,
							acc.customerId,
							refreshed.developerToken,
							refreshed.refreshToken,
						)
					: Promise.resolve(null),
				acc.status === 'SUSPENDED'
					? fetchCustomerSuspensionReasons(
							refreshed.mccAccountId,
							acc.customerId,
							refreshed.developerToken,
							refreshed.refreshToken,
						)
					: Promise.resolve(null),
			]);
			billingSetupStatus = billing;
			suspensionReasons = reasons ?? [];
		}

		snapshots.push({
			provider: 'google',
			integrationId: refreshed.id,
			accountTableId: row.id,
			externalAccountId: acc.customerId,
			clientId: row.clientId ?? null,
			accountName: acc.descriptiveName || row.accountName || acc.customerId,
			paymentStatus: mapGoogleStatusToPayment(acc.status, billingSetupStatus),
			rawStatusCode: acc.status,
			rawDisableReason: billingSetupStatus,
			checkedAt,
			googleSecondary: suspensionReasons.length > 0 ? { suspensionReasons } : null,
		});
	}

	return snapshots;
}
