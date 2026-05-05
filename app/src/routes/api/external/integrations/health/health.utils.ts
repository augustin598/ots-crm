const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type HealthStatus = 'healthy' | 'expiring_soon' | 'expired' | 'broken' | 'inactive';

export interface IntegrationHealth {
	platform: 'meta' | 'tiktok' | 'google' | 'gmail';
	integrationId: string;
	tokenExpiresAt: Date | null;
	daysUntilExpiry: number | null;
	status: HealthStatus;
	lastSyncAt: Date | null;
	lastError: string | null;
}

export function buildHealth(
	platform: 'meta' | 'tiktok' | 'google' | 'gmail',
	integrationId: string,
	tokenExpiresAt: Date | null,
	lastSyncAt: Date | null,
	lastError: string | null,
	isActive: boolean,
	now: number,
	consecutiveRefreshFailures = 0
): IntegrationHealth {
	let status: HealthStatus = 'healthy';
	let daysUntilExpiry: number | null = null;

	if (!isActive) {
		status = 'inactive';
	} else if (consecutiveRefreshFailures > 0) {
		status = 'broken';
	} else if (platform === 'google' || platform === 'gmail') {
		// Google/Gmail access_token lifetime is 1h; refresh_token is long-lived.
		// daysUntilExpiry is meaningless here — no failures means healthy.
		status = 'healthy';
		daysUntilExpiry = null;
	} else if (platform === 'meta' || platform === 'tiktok') {
		if (tokenExpiresAt) {
			const ms = tokenExpiresAt.getTime() - now;
			daysUntilExpiry = Math.floor(ms / 86400000);
			if (ms < 0) status = 'expired';
			else if (ms < SEVEN_DAYS_MS) status = 'expiring_soon';
		}
	}

	return {
		platform,
		integrationId,
		tokenExpiresAt,
		daysUntilExpiry,
		status,
		lastSyncAt,
		lastError
	};
}
