import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';
import { getAuthenticatedClient } from './auth';
import {
	listMccSubAccounts,
	fetchBillingSetupStatus,
	fetchGoogleDeliveryHealth,
	formatCustomerId,
} from './client';
import type { PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';
import {
	mapGoogleStatusPure,
	isKnownGoogleCustomerStatus,
	shouldFlagGoogleNoDelivery,
} from '$lib/server/ads/status-mappers';

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

		// billing_setup only exists for ENABLED customers. A SUSPENDED customer
		// carries no queryable reason — the Google Ads API exposes no suspension
		// reason field at all (see docs/ads-status-mappings.md), so `suspended`
		// is as specific as we can get from the API.
		const billingSetupStatus =
			acc.status === 'ENABLED'
				? await fetchBillingSetupStatus(
						refreshed.mccAccountId,
						acc.customerId,
						refreshed.developerToken,
						refreshed.refreshToken,
					)
				: null;

		let paymentStatus = mapGoogleStatusToPayment(acc.status, billingSetupStatus);
		let rawDisableReason: string | null = billingSetupStatus;

		// Delivery override — the Google analogue of TikTok's campaign-health check.
		// Every Google status field can report healthy while the account is in fact
		// stopped (unpaid balance being the common cause; Google surfaces that only
		// in its UI). If the account looks fine but served nothing yesterday despite
		// having ENABLED campaigns, it is not fine. Only runs when the status-level
		// check said `ok`, so already-flagged accounts cost no extra queries.
		if (paymentStatus === 'ok') {
			const health = await fetchGoogleDeliveryHealth(
				refreshed.mccAccountId,
				acc.customerId,
				refreshed.developerToken,
				refreshed.refreshToken,
			);
			if (shouldFlagGoogleNoDelivery(health)) {
				paymentStatus = 'risk_review';
				rawDisableReason = 'no_delivery';
			}
		}

		snapshots.push({
			provider: 'google',
			integrationId: refreshed.id,
			accountTableId: row.id,
			externalAccountId: acc.customerId,
			clientId: row.clientId ?? null,
			accountName: acc.descriptiveName || row.accountName || acc.customerId,
			paymentStatus,
			rawStatusCode: acc.status,
			rawDisableReason,
			checkedAt,
		});
	}

	return snapshots;
}
