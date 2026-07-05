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

// Single User-Agent for everything that talks to business.facebook.com with the
// stored session cookies (plain fetch downloads + headless session refresh).
// Facebook binds sessions to browser fingerprints — the UA must stay identical
// across all consumers of the same cookie jar or the session gets invalidated.
export const FB_USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
