import { logInfo, logError } from '$lib/server/logger';
import { createHmac } from 'crypto';

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

export interface MetaAdsAdAccount {
	adAccountId: string; // e.g. act_XXXXXXXXX
	accountName: string;
	accountStatus: number; // 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, etc.
	isActive: boolean;
}

export interface MetaAdsInsightData {
	spend: string; // e.g. "2207.59"
	impressions: string;
	clicks: string;
	dateStart: string; // "2026-02-01"
	dateStop: string; // "2026-02-28"
}

/**
 * Generate appsecret_proof for Meta API calls (HMAC-SHA256 of access_token with app secret)
 */
function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

/**
 * List all ad accounts owned by a Business Manager
 */
export async function listBusinessAdAccounts(
	businessId: string,
	accessToken: string
): Promise<MetaAdsAdAccount[]> {
	logInfo('meta-ads', `Listing ad accounts for BM`, { metadata: { businessId } });

	const accounts: MetaAdsAdAccount[] = [];
	let url: string | null = `${META_GRAPH_URL}/${businessId}/owned_ad_accounts?fields=id,name,account_status&limit=100&access_token=${accessToken}`;

	try {
		while (url) {
			const res = await fetch(url);
			const data = await res.json();

			if (data.error) {
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			for (const acc of data.data || []) {
				accounts.push({
					adAccountId: acc.id || '',
					accountName: acc.name || '',
					accountStatus: acc.account_status || 0,
					isActive: acc.account_status === 1
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Found ${accounts.length} ad accounts`, { metadata: { businessId } });
		return accounts;
	} catch (err) {
		logError('meta-ads', `Failed to list ad accounts`, {
			metadata: { businessId, error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * List insights (spending data) for a specific ad account.
 * Uses time_increment=monthly to get per-month breakdowns.
 */
export async function listAdAccountInsights(
	adAccountId: string,
	accessToken: string,
	appSecret: string,
	since: string,
	until: string
): Promise<MetaAdsInsightData[]> {
	logInfo('meta-ads', `Fetching insights for ${adAccountId}`, { metadata: { since, until } });

	const proof = generateAppSecretProof(accessToken, appSecret);
	const timeRange = JSON.stringify({ since, until });
	const fields = 'spend,impressions,clicks';

	const params = new URLSearchParams({
		fields,
		time_range: timeRange,
		time_increment: 'monthly',
		access_token: accessToken,
		appsecret_proof: proof
	});

	const url = `${META_GRAPH_URL}/${adAccountId}/insights?${params.toString()}`;

	try {
		const res = await fetch(url);
		const data = await res.json();

		if (data.error) {
			logError('meta-ads', `Insights API error for ${adAccountId}`, {
				metadata: { errorMessage: data.error.message, errorCode: data.error.code }
			});
			throw new Error(`Meta API error: ${data.error.message}`);
		}

		const insights: MetaAdsInsightData[] = [];
		for (const row of data.data || []) {
			insights.push({
				spend: row.spend || '0',
				impressions: row.impressions || '0',
				clicks: row.clicks || '0',
				dateStart: row.date_start,
				dateStop: row.date_stop
			});
		}

		logInfo('meta-ads', `Got ${insights.length} insight periods for ${adAccountId}`, {
			metadata: { since, until }
		});
		return insights;
	} catch (err) {
		logError('meta-ads', `Failed to fetch insights for ${adAccountId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Get the date range for sync (current + previous 2 months).
 * Returns YYYY-MM-DD strings (local timezone).
 */
export function getSyncDateRange(referenceDate?: Date): { startDate: string; endDate: string } {
	const date = referenceDate || new Date();

	// Start: 2 months ago, 1st day
	const startMonth = new Date(date.getFullYear(), date.getMonth() - 2, 1);
	// End: today (insights are available up to current day)
	const pad = (n: number) => String(n).padStart(2, '0');
	const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	return {
		startDate: formatLocal(startMonth),
		endDate: formatLocal(date)
	};
}
