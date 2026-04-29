// Meta Marketing API v25 — account_status codes
// https://developers.facebook.com/docs/marketing-api/reference/ad-account/
export const META_AD_ACCOUNT_STATUS = {
	ACTIVE: 1,
	DISABLED: 2,
	UNSETTLED: 3,
	PENDING_RISK_REVIEW: 7,
	PENDING_SETTLEMENT: 8,
	IN_GRACE_PERIOD: 9,
	PENDING_CLOSURE: 100,
	CLOSED: 101,
} as const;

// Statuses where Meta still allows running ads (1=ACTIVE, 9=IN_GRACE_PERIOD).
// Grace period accounts have an outstanding invoice but ads keep running.
export const META_ACTIVE_AD_ACCOUNT_STATUSES = new Set([
	META_AD_ACCOUNT_STATUS.ACTIVE,
	META_AD_ACCOUNT_STATUS.IN_GRACE_PERIOD,
]);
