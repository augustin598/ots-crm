export type AdsProvider = 'meta' | 'google' | 'tiktok';

export type AdsPaymentStatus =
	| 'ok'
	| 'grace_period'
	| 'risk_review'
	| 'payment_failed'
	| 'suspended'
	| 'closed';

export interface PaymentStatusSnapshot {
	provider: AdsProvider;
	integrationId: string;
	accountTableId: string;
	externalAccountId: string;
	clientId: string | null;
	accountName: string;
	paymentStatus: AdsPaymentStatus;
	rawStatusCode: string | number;
	rawDisableReason?: string | number | null;
	/** Outstanding balance in smallest currency unit (cents). Negative or zero = no debt; positive = owed. null when unavailable. */
	balanceCents?: number | null;
	/** ISO currency code (RON, EUR, USD). null when unavailable. */
	currencyCode?: string | null;
	checkedAt: Date;
}

export const PAYMENT_STATUS_LABEL_RO: Record<AdsPaymentStatus, string> = {
	ok: 'Activ',
	grace_period: 'Perioadă de grație',
	risk_review: 'Revizuire în curs',
	payment_failed: 'Plată eșuată',
	suspended: 'Suspendat',
	closed: 'Închis',
};

export const PROVIDER_LABEL: Record<AdsProvider, string> = {
	meta: 'Meta (Facebook)',
	google: 'Google Ads',
	tiktok: 'TikTok Ads',
};

export const PROVIDER_BILLING_URL: Record<AdsProvider, (externalId: string) => string> = {
	meta: (id) => `https://business.facebook.com/billing_hub/payment_settings?asset_id=${id.replace(/^act_/, '')}`,
	google: (id) => `https://ads.google.com/aw/billing/summary?ocid=${id}`,
	// Payment/invoice view per advertiser — matches the URL pattern used by
	// the invoice scraper (see tiktok-ads/invoice-downloader.ts). The older
	// /i18n/payment/ path redirects to the homepage and doesn't work.
	tiktok: (id) => `https://ads.tiktok.com/i18n/account/payment_invoice?aadvid=${id}`,
};

/**
 * Account management URL — for statuses that need non-billing intervention
 * (suspended, risk_review) where opening the billing page is misleading.
 */
export const PROVIDER_ACCOUNT_URL: Record<AdsProvider, (externalId: string) => string> = {
	meta: (id) => `https://business.facebook.com/settings/ad-accounts?selected_asset_id=${id.replace(/^act_/, '')}`,
	google: (id) => `https://ads.google.com/aw/overview?ocid=${id}`,
	tiktok: (id) => `https://ads.tiktok.com/i18n/dashboard?aadvid=${id}`,
};

/**
 * Returns the best action URL + label for a given (provider, status) pair.
 * Payment issues → billing page. Suspension/review → account settings page.
 */
export function actionForStatus(
	provider: AdsProvider,
	status: AdsPaymentStatus,
	externalId: string,
): { url: string; label: string } | null {
	switch (status) {
		case 'grace_period':
		case 'payment_failed':
			return { url: PROVIDER_BILLING_URL[provider](externalId), label: 'Plătește' };
		case 'risk_review':
			return { url: PROVIDER_ACCOUNT_URL[provider](externalId), label: 'Verifică' };
		case 'suspended':
			return { url: PROVIDER_ACCOUNT_URL[provider](externalId), label: 'Vezi contul' };
		case 'ok':
		case 'closed':
			return null;
	}
}

const BAD_STATUSES: ReadonlySet<AdsPaymentStatus> = new Set([
	'grace_period',
	'risk_review',
	'payment_failed',
	'suspended',
	'closed',
]);

export function isBadStatus(status: AdsPaymentStatus): boolean {
	return BAD_STATUSES.has(status);
}

export function priorityFor(status: AdsPaymentStatus): 'low' | 'medium' | 'high' | 'urgent' {
	if (status === 'suspended' || status === 'closed' || status === 'payment_failed') return 'urgent';
	if (status === 'grace_period' || status === 'risk_review') return 'high';
	return 'medium';
}
