import { GoogleAdsApi } from 'google-ads-api';
import { env } from '$env/dynamic/private';
import { logInfo, logError, logWarning } from '$lib/server/logger';

export interface GoogleAdsInvoiceData {
	invoiceId: string;
	invoiceType: string;
	issueDate: string | null;
	dueDate: string | null;
	currencyCode: string;
	subtotalAmountMicros: number;
	totalAmountMicros: number;
	pdfUrl: string | null;
	serviceDateRange: {
		startDate: string | null;
		endDate: string | null;
	} | null;
	/** Customer IDs (clean, no dashes) covered by this invoice's account budget summaries */
	accountCustomerIds: string[];
}

export interface GoogleAdsSubAccount {
	customerId: string; // Clean, no dashes
	descriptiveName: string;
	status: string; // ENABLED, CANCELLED, SUSPENDED, CLOSED
	isManager: boolean;
}

/**
 * Strip dashes and whitespace from a Google Ads customer ID (e.g., "123-456-7890" → "1234567890")
 */
export function formatCustomerId(id: string): string {
	return id.trim().replace(/-/g, '');
}

/**
 * Format a display-friendly customer ID (e.g., "1234567890" → "123-456-7890")
 */
export function formatCustomerIdDisplay(id: string): string {
	const clean = id.replace(/-/g, '');
	if (clean.length !== 10) return id;
	return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

/**
 * Create a Google Ads API customer client for a specific MCC + refresh token
 */
function getCustomerClient(mccAccountId: string, developerToken: string, refreshToken: string) {
	const cleanMcc = formatCustomerId(mccAccountId);

	const client = new GoogleAdsApi({
		client_id: env.GOOGLE_CLIENT_ID!,
		client_secret: env.GOOGLE_CLIENT_SECRET!,
		developer_token: developerToken
	});

	return client.Customer({
		customer_id: cleanMcc,
		login_customer_id: cleanMcc,
		refresh_token: refreshToken
	});
}

/**
 * List all sub-accounts (customer clients) under the MCC.
 */
export async function listMccSubAccounts(
	mccAccountId: string,
	developerToken: string,
	refreshToken: string
): Promise<GoogleAdsSubAccount[]> {
	const cleanMcc = formatCustomerId(mccAccountId);
	logInfo('google-ads', `Listing MCC sub-accounts`, { metadata: { mcc: cleanMcc } });

	try {
		const customer = getCustomerClient(mccAccountId, developerToken, refreshToken);

		const results = await customer.query(`
			SELECT
				customer_client.id,
				customer_client.descriptive_name,
				customer_client.status,
				customer_client.manager
			FROM customer_client
			WHERE customer_client.manager = false
		`);

		const accounts: GoogleAdsSubAccount[] = results.map((row: any) => ({
			customerId: String(row.customer_client?.id || ''),
			descriptiveName: row.customer_client?.descriptive_name || '',
			status: row.customer_client?.status === 2 ? 'ENABLED' :
				row.customer_client?.status === 3 ? 'CANCELLED' :
				row.customer_client?.status === 4 ? 'SUSPENDED' :
				row.customer_client?.status === 5 ? 'CLOSED' : 'UNKNOWN',
			isManager: row.customer_client?.manager === true
		}));

		logInfo('google-ads', `Found ${accounts.length} sub-accounts under MCC`, { metadata: { mcc: cleanMcc } });
		return accounts;
	} catch (err) {
		logError('google-ads', `Failed to list MCC sub-accounts`, {
			metadata: { mcc: cleanMcc, error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		throw err;
	}
}

/**
 * List invoices at MCC (manager/billing account) level.
 * Uses the InvoiceService via google-ads-api.
 */
export async function listInvoices(
	mccAccountId: string,
	developerToken: string,
	refreshToken: string,
	billingYear: string,
	billingMonth: string
): Promise<GoogleAdsInvoiceData[]> {
	const cleanMcc = formatCustomerId(mccAccountId);

	logInfo('google-ads', `Listing MCC invoices`, {
		metadata: { mcc: cleanMcc, year: billingYear, month: billingMonth }
	});

	try {
		const customer = getCustomerClient(mccAccountId, developerToken, refreshToken);

		// InvoiceService.ListInvoices via the client
		const invoices = await customer.invoices.listInvoices({
			customer_id: cleanMcc,
			billing_setup: `customers/${cleanMcc}/billingSetups/-`,
			issue_year: billingYear,
			issue_month: billingMonth as any
		});

		const result: GoogleAdsInvoiceData[] = (invoices || []).map((inv: any) => {
			// Extract sub-account customer IDs from accountBudgetSummaries
			const accountCustomerIds: string[] = (inv.account_budget_summaries || [])
				.map((abs: any) => {
					const match = (abs.customer || '').match(/customers\/(\d+)/);
					return match ? match[1] : null;
				})
				.filter(Boolean) as string[];

			return {
				invoiceId: inv.id || '',
				invoiceType: inv.type === 2 ? 'INVOICE' : inv.type === 3 ? 'CREDIT_MEMO' : 'INVOICE',
				issueDate: inv.issue_date || null,
				dueDate: inv.due_date || null,
				currencyCode: inv.currency_code || 'EUR',
				subtotalAmountMicros: Number(inv.subtotal_amount_micros || 0),
				totalAmountMicros: Number(inv.total_amount_micros || 0),
				pdfUrl: inv.pdf_url || null,
				serviceDateRange: inv.service_date_range ? {
					startDate: inv.service_date_range.start_date || null,
					endDate: inv.service_date_range.end_date || null
				} : null,
				accountCustomerIds
			};
		});

		logInfo('google-ads', `Found ${result.length} MCC invoices`, {
			metadata: { mcc: cleanMcc, month: billingMonth, year: billingYear }
		});

		return result;
	} catch (err) {
		logError('google-ads', `Failed to list MCC invoices`, {
			metadata: { mcc: cleanMcc, error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		throw err;
	}
}

/**
 * Download an invoice PDF from the time-limited URL
 */
export async function downloadInvoicePdf(
	pdfUrl: string,
	accessToken: string
): Promise<Buffer> {
	const response = await fetch(pdfUrl, {
		headers: {
			'Authorization': `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		throw new Error(`Failed to download PDF: ${response.status}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	return Buffer.from(arrayBuffer);
}

// ---- Campaign reporting types ----

export interface GoogleAdsCampaignInsight {
	campaignId: string;
	campaignName: string;
	channelType: string;
	spend: string;
	impressions: string;
	clicks: string;
	cpc: string;
	cpm: string;
	ctr: string;
	conversions: number;
	conversionValue: number;
	costPerConversion: number;
	videoViews: number;
	resultType: string;
	cpaLabel: string;
	dateStart: string;
	dateStop: string;
}

export interface GoogleAdsCampaignInfo {
	campaignId: string;
	campaignName: string;
	status: string;
	channelType: string;
	startDate: string | null;
	endDate: string | null;
	dailyBudget: string | null;
}

export interface GoogleAdsAdGroupInsight {
	adGroupId: string;
	adGroupName: string;
	campaignId: string;
	spend: string;
	impressions: string;
	clicks: string;
	cpc: string;
	cpm: string;
	ctr: string;
	conversions: number;
	conversionValue: number;
	costPerConversion: number;
	videoViews: number;
	resultType: string;
	cpaLabel: string;
	dailyBudget: string | null;
	dateStart: string;
	dateStop: string;
}

export interface GoogleAdsDemographicBreakdown {
	gender: Array<{ label: string; spend: number; impressions: number; clicks: number; results: number }>;
	age: Array<{ label: string; spend: number; impressions: number; clicks: number; results: number }>;
	devicePlatform: Array<{ label: string; spend: number; impressions: number; clicks: number; results: number }>;
}

/** Channel type → result label mapping */
export const GOOGLE_CHANNEL_MAP: Record<string, { label: string; cpaLabel: string }> = {
	SEARCH: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	DISPLAY: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	VIDEO: { label: 'Vizualizări', cpaLabel: 'Cost/vizualizare' },
	SHOPPING: { label: 'Achiziții', cpaLabel: 'Cost/achiziție' },
	PERFORMANCE_MAX: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	DEMAND_GEN: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
	MULTI_CHANNEL: { label: 'Conversii', cpaLabel: 'Cost/conversie' },
};

/**
 * Create a Google Ads API client for a specific sub-account under MCC
 */
function getSubAccountClient(mccAccountId: string, customerId: string, developerToken: string, refreshToken: string) {
	const cleanMcc = formatCustomerId(mccAccountId);
	const cleanCustomer = formatCustomerId(customerId);

	const client = new GoogleAdsApi({
		client_id: env.GOOGLE_CLIENT_ID!,
		client_secret: env.GOOGLE_CLIENT_SECRET!,
		developer_token: developerToken
	});

	return client.Customer({
		customer_id: cleanCustomer,
		login_customer_id: cleanMcc,
		refresh_token: refreshToken
	});
}

/**
 * Fetch campaign-level daily insights for a sub-account via GAQL.
 */
export async function listCampaignInsights(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	startDate: string,
	endDate: string
): Promise<GoogleAdsCampaignInsight[]> {
	logInfo('google-ads', `Fetching campaign insights for ${customerId}`, { metadata: { startDate, endDate } });

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const results = await customer.query(`
			SELECT
				campaign.id,
				campaign.name,
				campaign.advertising_channel_type,
				metrics.cost_micros,
				metrics.impressions,
				metrics.clicks,
				metrics.ctr,
				metrics.average_cpc,
				metrics.average_cpm,
				metrics.conversions,
				metrics.conversions_value,
				metrics.cost_per_conversion,
				metrics.video_views,
				segments.date
			FROM campaign
			WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
				AND campaign.status != 'REMOVED'
			ORDER BY segments.date
		`);

		const insights: GoogleAdsCampaignInsight[] = results.map((row: any) => {
			const costMicros = Number(row.metrics?.cost_micros || 0);
			const spend = costMicros / 1_000_000;
			const conversions = Number(row.metrics?.conversions || 0);
			const channelType = String(row.campaign?.advertising_channel_type || '').replace(/^\d+$/, 'UNKNOWN');

			// Map numeric channel types to strings
			const CHANNEL_NAMES: Record<number, string> = {
				2: 'SEARCH', 3: 'DISPLAY', 6: 'VIDEO', 7: 'SHOPPING',
				8: 'HOTEL', 9: 'PERFORMANCE_MAX', 11: 'DEMAND_GEN', 10: 'MULTI_CHANNEL'
			};
			const channelStr = typeof row.campaign?.advertising_channel_type === 'number'
				? CHANNEL_NAMES[row.campaign.advertising_channel_type] || 'UNKNOWN'
				: channelType;

			const goalDef = GOOGLE_CHANNEL_MAP[channelStr];

			return {
				campaignId: String(row.campaign?.id || ''),
				campaignName: row.campaign?.name || '',
				channelType: channelStr,
				spend: spend.toFixed(2),
				impressions: String(row.metrics?.impressions || 0),
				clicks: String(row.metrics?.clicks || 0),
				cpc: ((Number(row.metrics?.average_cpc || 0)) / 1_000_000).toFixed(2),
				cpm: ((Number(row.metrics?.average_cpm || 0)) / 1_000_000).toFixed(2),
				ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
				conversions: Math.round(conversions),
				conversionValue: Number(row.metrics?.conversions_value || 0),
				costPerConversion: conversions > 0 ? spend / conversions : 0,
				videoViews: Number(row.metrics?.video_views || 0),
				resultType: goalDef?.label || 'Conversii',
				cpaLabel: goalDef?.cpaLabel || 'Cost/conversie',
				dateStart: row.segments?.date || startDate,
				dateStop: row.segments?.date || endDate
			};
		});

		logInfo('google-ads', `Got ${insights.length} campaign insight rows for ${customerId}`);
		return insights;
	} catch (err) {
		logError('google-ads', `Failed to fetch campaign insights for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		throw err;
	}
}

/**
 * List campaigns with status, budget, and dates for a sub-account.
 */
export async function listCampaigns(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string
): Promise<GoogleAdsCampaignInfo[]> {
	logInfo('google-ads', `Listing campaigns for ${customerId}`);

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const results = await customer.query(`
			SELECT
				campaign.id,
				campaign.name,
				campaign.status,
				campaign.advertising_channel_type,
				campaign.start_date,
				campaign.end_date,
				campaign_budget.amount_micros
			FROM campaign
			WHERE campaign.status != 'REMOVED'
		`);

		const STATUS_MAP: Record<number, string> = {
			2: 'ENABLED', 3: 'PAUSED', 4: 'REMOVED'
		};
		const CHANNEL_NAMES: Record<number, string> = {
			2: 'SEARCH', 3: 'DISPLAY', 6: 'VIDEO', 7: 'SHOPPING',
			8: 'HOTEL', 9: 'PERFORMANCE_MAX', 11: 'DEMAND_GEN', 10: 'MULTI_CHANNEL'
		};

		const campaigns: GoogleAdsCampaignInfo[] = results.map((row: any) => {
			const budgetMicros = Number(row.campaign_budget?.amount_micros || 0);
			const status = typeof row.campaign?.status === 'number'
				? STATUS_MAP[row.campaign.status] || 'UNKNOWN'
				: String(row.campaign?.status || 'UNKNOWN');
			const channelType = typeof row.campaign?.advertising_channel_type === 'number'
				? CHANNEL_NAMES[row.campaign.advertising_channel_type] || 'UNKNOWN'
				: String(row.campaign?.advertising_channel_type || 'UNKNOWN');

			return {
				campaignId: String(row.campaign?.id || ''),
				campaignName: row.campaign?.name || '',
				status: status === 'ENABLED' ? 'ACTIVE' : status,
				channelType,
				startDate: row.campaign?.start_date || null,
				endDate: row.campaign?.end_date || null,
				dailyBudget: budgetMicros > 0 ? (budgetMicros / 1_000_000).toFixed(2) : null
			};
		});

		logInfo('google-ads', `Found ${campaigns.length} campaigns for ${customerId}`);
		return campaigns;
	} catch (err) {
		logError('google-ads', `Failed to list campaigns for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		throw err;
	}
}

/**
 * Fetch ad group-level insights for a specific campaign.
 */
export async function listAdGroupInsights(
	mccAccountId: string,
	customerId: string,
	campaignId: string,
	developerToken: string,
	refreshToken: string,
	startDate: string,
	endDate: string
): Promise<GoogleAdsAdGroupInsight[]> {
	logInfo('google-ads', `Fetching ad group insights for campaign ${campaignId}`);

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const results = await customer.query(`
			SELECT
				ad_group.id,
				ad_group.name,
				ad_group.campaign,
				metrics.cost_micros,
				metrics.impressions,
				metrics.clicks,
				metrics.ctr,
				metrics.average_cpc,
				metrics.average_cpm,
				metrics.conversions,
				metrics.conversions_value,
				metrics.video_views,
				segments.date
			FROM ad_group
			WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
				AND campaign.id = ${campaignId}
				AND ad_group.status != 'REMOVED'
			ORDER BY segments.date
		`);

		const insights: GoogleAdsAdGroupInsight[] = results.map((row: any) => {
			const costMicros = Number(row.metrics?.cost_micros || 0);
			const spend = costMicros / 1_000_000;
			const conversions = Math.round(Number(row.metrics?.conversions || 0));

			return {
				adGroupId: String(row.ad_group?.id || ''),
				adGroupName: row.ad_group?.name || '',
				campaignId,
				spend: spend.toFixed(2),
				impressions: String(row.metrics?.impressions || 0),
				clicks: String(row.metrics?.clicks || 0),
				cpc: ((Number(row.metrics?.average_cpc || 0)) / 1_000_000).toFixed(2),
				cpm: ((Number(row.metrics?.average_cpm || 0)) / 1_000_000).toFixed(2),
				ctr: (Number(row.metrics?.ctr || 0) * 100).toFixed(2),
				conversions,
				conversionValue: Number(row.metrics?.conversions_value || 0),
				costPerConversion: conversions > 0 ? spend / conversions : 0,
				videoViews: Number(row.metrics?.video_views || 0),
				resultType: '',
				cpaLabel: 'CPA',
				dailyBudget: null,
				dateStart: row.segments?.date || startDate,
				dateStop: row.segments?.date || endDate
			};
		});

		logInfo('google-ads', `Got ${insights.length} ad group insight rows for campaign ${campaignId}`);
		return insights;
	} catch (err) {
		logError('google-ads', `Failed to fetch ad group insights`, {
			metadata: { campaignId, error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		throw err;
	}
}

/**
 * Fetch demographic breakdowns (gender, age, device) for a sub-account.
 */
export async function listDemographicInsights(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	startDate: string,
	endDate: string
): Promise<GoogleAdsDemographicBreakdown> {
	logInfo('google-ads', `Fetching demographics for ${customerId}`, { metadata: { startDate, endDate } });

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const GENDER_MAP: Record<number | string, string> = { 10: 'male', 11: 'female', 20: 'unknown', MALE: 'male', FEMALE: 'female', UNDETERMINED: 'unknown' };
		const AGE_MAP: Record<number | string, string> = {
			503001: '18-24', 503002: '25-34', 503003: '35-44', 503004: '45-54', 503005: '55-64', 503006: '65+', 503999: 'unknown',
			AGE_RANGE_18_24: '18-24', AGE_RANGE_25_34: '25-34', AGE_RANGE_35_44: '35-44',
			AGE_RANGE_45_54: '45-54', AGE_RANGE_55_64: '55-64', AGE_RANGE_65_UP: '65+', AGE_RANGE_UNDETERMINED: 'unknown'
		};
		const DEVICE_MAP: Record<number | string, string> = {
			2: 'mobile_app', 3: 'desktop', 4: 'mobile_app', 6: 'desktop',
			MOBILE: 'mobile_app', DESKTOP: 'desktop', TABLET: 'mobile_app', CONNECTED_TV: 'desktop'
		};

		const [genderResults, ageResults, deviceResults] = await Promise.all([
			customer.query(`
				SELECT ad_group_criterion.gender.type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
				FROM gender_view
				WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
			`),
			customer.query(`
				SELECT ad_group_criterion.age_range.type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
				FROM age_range_view
				WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
			`),
			customer.query(`
				SELECT segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
				FROM campaign
				WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
			`)
		]);

		function aggregateRows(rows: any[], labelExtractor: (row: any) => string, labelMap: Record<string | number, string>) {
			const map = new Map<string, { label: string; spend: number; impressions: number; clicks: number; results: number }>();
			for (const row of rows) {
				const rawLabel = labelExtractor(row);
				const label = labelMap[rawLabel] || String(rawLabel).toLowerCase();
				const existing = map.get(label) || { label, spend: 0, impressions: 0, clicks: 0, results: 0 };
				existing.spend += Number(row.metrics?.cost_micros || 0) / 1_000_000;
				existing.impressions += Number(row.metrics?.impressions || 0);
				existing.clicks += Number(row.metrics?.clicks || 0);
				existing.results += Math.round(Number(row.metrics?.conversions || 0));
				map.set(label, existing);
			}
			return Array.from(map.values()).filter(s => s.label !== 'unknown' || s.spend > 0).sort((a, b) => b.spend - a.spend);
		}

		const result: GoogleAdsDemographicBreakdown = {
			gender: aggregateRows(genderResults, r => r.ad_group_criterion?.gender?.type, GENDER_MAP),
			age: aggregateRows(ageResults, r => r.ad_group_criterion?.age_range?.type, AGE_MAP),
			devicePlatform: aggregateRows(deviceResults, r => r.segments?.device, DEVICE_MAP)
		};

		logInfo('google-ads', `Demographics loaded for ${customerId}`, {
			metadata: { gender: result.gender.length, age: result.age.length, device: result.devicePlatform.length }
		});
		return result;
	} catch (err) {
		logError('google-ads', `Failed to fetch demographics for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		return { gender: [], age: [], devicePlatform: [] };
	}
}

/**
 * Get the months to query for invoice sync (current + previous 2 months)
 */
export function getSyncMonths(referenceDate?: Date): Array<{ year: string; month: string }> {
	const date = referenceDate || new Date();
	const months: Array<{ year: string; month: string }> = [];

	const MONTH_NAMES = [
		'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
		'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
	];

	for (let i = 0; i < 3; i++) {
		const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
		months.push({
			year: d.getFullYear().toString(),
			month: MONTH_NAMES[d.getMonth()]
		});
	}

	return months;
}
