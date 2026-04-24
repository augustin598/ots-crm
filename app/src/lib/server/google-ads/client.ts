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
	currencyCode: string;
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
				customer_client.manager,
				customer_client.currency_code
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
			isManager: row.customer_client?.manager === true,
			currencyCode: row.customer_client?.currency_code || 'USD'
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
 * List invoices for a specific sub-account (not MCC).
 * Each sub-account has its own billing setup and invoices.
 */
export async function listInvoices(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	billingYear: string,
	billingMonth: string
): Promise<GoogleAdsInvoiceData[]> {
	const cleanCustomer = formatCustomerId(customerId);
	const cleanMcc = formatCustomerId(mccAccountId);

	logInfo('google-ads', `Listing invoices for sub-account`, {
		metadata: { mcc: cleanMcc, customerId: cleanCustomer, year: billingYear, month: billingMonth }
	});

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		// First, find the billing setup ID for this account via GAQL
		// Include CANCELLED setups because they still have historical invoices
		const billingSetups = await customer.query(`
			SELECT billing_setup.id, billing_setup.status
			FROM billing_setup
			WHERE billing_setup.status IN ('APPROVED', 'CANCELLED')
		`);

		if (!billingSetups || billingSetups.length === 0) {
			logInfo('google-ads', `No billing setup found for ${cleanCustomer} - skipping`);
			return [];
		}

		const allInvoices: GoogleAdsInvoiceData[] = [];

		// Query invoices for each billing setup
		for (const bs of billingSetups as any[]) {
			const billingSetupId = bs.billing_setup?.id;
			if (!billingSetupId) continue;

			const billingSetupResource = `customers/${cleanCustomer}/billingSetups/${billingSetupId}`;

			let invoices;
			try {
				invoices = await customer.invoices.listInvoices({
					customer_id: cleanCustomer,
					billing_setup: billingSetupResource,
					issue_year: billingYear,
					issue_month: billingMonth as any
				} as any);
			} catch (bsErr) {
				const msg = bsErr instanceof Error ? bsErr.message : JSON.stringify(bsErr);
				if (msg.includes('BILLING_SETUP_NOT_ON_MONTHLY_INVOICING')) {
					logInfo('google-ads', `Billing setup ${billingSetupId} for ${cleanCustomer} is not on monthly invoicing - skipping`);
					continue;
				}
				throw bsErr;
			}

			for (const inv of ((invoices as unknown as any[]) || []) as any[]) {
				const accountCustomerIds: string[] = (inv.account_budget_summaries || [])
					.map((abs: any) => {
						const match = (abs.customer || '').match(/customers\/(\d+)/);
						return match ? match[1] : null;
					})
					.filter(Boolean) as string[];

				allInvoices.push({
					invoiceId: inv.id || '',
					invoiceType: inv.type === 2 ? 'INVOICE' : inv.type === 3 ? 'CREDIT_MEMO' : 'INVOICE',
					issueDate: inv.issue_date || null,
					dueDate: inv.due_date || null,
					currencyCode: inv.currency_code || 'USD',
					subtotalAmountMicros: Number(inv.subtotal_amount_micros || 0),
					totalAmountMicros: Number(inv.total_amount_micros || 0),
					pdfUrl: inv.pdf_url || null,
					serviceDateRange: inv.service_date_range ? {
						startDate: inv.service_date_range.start_date || null,
						endDate: inv.service_date_range.end_date || null
					} : null,
					accountCustomerIds: accountCustomerIds.length > 0 ? accountCustomerIds : [cleanCustomer]
				});
			}
		}

		logInfo('google-ads', `Found ${allInvoices.length} invoices for ${cleanCustomer}`, {
			metadata: { customerId: cleanCustomer, month: billingMonth, year: billingYear }
		});

		return allInvoices;
	} catch (err) {
		logError('google-ads', `Failed to list invoices for ${cleanCustomer}`, {
			metadata: { customerId: cleanCustomer, error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		throw err;
	}
}

export interface GoogleAdsMonthlySpend {
	month: string; // YYYY-MM
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	currencyCode: string;
}

/**
 * Fetch monthly spend aggregates for a sub-account (last 6 months).
 */
export async function listMonthlySpend(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	since?: string,
	until?: string,
	cachedCurrencyCode?: string
): Promise<GoogleAdsMonthlySpend[]> {
	logInfo('google-ads', `Fetching monthly spend for ${customerId}`);

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		// segments.month requires dates to be 1st of month (YYYY-MM-01)
		const now = new Date();
		let startDate: string;
		let endDate: string;

		if (since && until) {
			// Convert YYYY-MM-DD to month boundaries
			const sinceDate = new Date(since);
			const untilDate = new Date(until);
			startDate = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-01`;
			endDate = `${untilDate.getFullYear()}-${String(untilDate.getMonth() + 1).padStart(2, '0')}-01`;
		} else {
			// Default: last 24 months (data accumulates in DB, so we need a wide initial range)
			const startMonth = new Date(now.getFullYear(), now.getMonth() - 24, 1);
			startDate = `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}-01`;
			const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			endDate = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-01`;
		}

		const results = await customer.query(`
			SELECT
				segments.month,
				metrics.cost_micros,
				metrics.impressions,
				metrics.clicks,
				metrics.conversions
			FROM customer
			WHERE segments.month BETWEEN '${startDate}' AND '${endDate}'
		`);

		// Use cached currency from DB if available, otherwise query Google Ads API
		let currencyCode = cachedCurrencyCode || '';
		if (!currencyCode) {
			const customerInfo = await customer.query(`
				SELECT customer.currency_code FROM customer LIMIT 1
			`);
			currencyCode = (customerInfo as any[])?.[0]?.customer?.currency_code || 'USD';
		}

		const monthlyData: GoogleAdsMonthlySpend[] = (results as any[]).map((row) => ({
			month: row.segments?.month || '',
			spend: Number(row.metrics?.cost_micros || 0) / 1_000_000,
			impressions: Number(row.metrics?.impressions || 0),
			clicks: Number(row.metrics?.clicks || 0),
			conversions: Math.round(Number(row.metrics?.conversions || 0)),
			currencyCode
		})).filter(r => r.month && r.spend > 0)
		.sort((a, b) => b.month.localeCompare(a.month));

		logInfo('google-ads', `Got ${monthlyData.length} months of spend for ${customerId}`);
		return monthlyData;
	} catch (err) {
		logError('google-ads', `Failed to fetch monthly spend for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		return [];
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

export interface GoogleAdsConversionAction {
	name: string;
	conversions: number;
	conversionValue: number;
}

/**
 * Fetch conversion actions breakdown for a sub-account.
 */
export async function listConversionActions(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	startDate: string,
	endDate: string
): Promise<GoogleAdsConversionAction[]> {
	logInfo('google-ads', `Fetching conversion actions for ${customerId}`, { metadata: { startDate, endDate } });

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const results = await customer.query(`
			SELECT
				segments.conversion_action_name,
				metrics.conversions,
				metrics.conversions_value
			FROM campaign
			WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
				AND campaign.status != 'REMOVED'
				AND metrics.conversions > 0
		`);

		const actionMap = new Map<string, { conversions: number; conversionValue: number }>();
		for (const row of results as any[]) {
			const name = row.segments?.conversion_action_name || 'Unknown';
			const existing = actionMap.get(name) || { conversions: 0, conversionValue: 0 };
			existing.conversions += Number(row.metrics?.conversions || 0);
			existing.conversionValue += Number(row.metrics?.conversions_value || 0);
			actionMap.set(name, existing);
		}

		const actions: GoogleAdsConversionAction[] = Array.from(actionMap.entries())
			.map(([name, data]) => ({
				name,
				conversions: Math.round(data.conversions),
				conversionValue: data.conversionValue
			}))
			.sort((a, b) => b.conversions - a.conversions);

		logInfo('google-ads', `Got ${actions.length} conversion actions for ${customerId}`);
		return actions;
	} catch (err) {
		logError('google-ads', `Failed to fetch conversion actions for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		return [];
	}
}

/** Per-campaign conversion action breakdown */
export interface GoogleAdsCampaignConversionAction {
	campaignId: string;
	name: string;
	conversions: number;
	conversionValue: number;
}

export async function listCampaignConversionActions(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	startDate: string,
	endDate: string
): Promise<Map<string, GoogleAdsConversionAction[]>> {
	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const results = await customer.query(`
			SELECT
				campaign.id,
				segments.conversion_action_name,
				metrics.conversions,
				metrics.conversions_value
			FROM campaign
			WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
				AND campaign.status != 'REMOVED'
				AND metrics.conversions > 0
		`);

		const byCampaign = new Map<string, Map<string, { conversions: number; conversionValue: number }>>();
		for (const row of results as any[]) {
			const campaignId = String(row.campaign?.id || '');
			const name = row.segments?.conversion_action_name || 'Unknown';
			if (!byCampaign.has(campaignId)) byCampaign.set(campaignId, new Map());
			const actionMap = byCampaign.get(campaignId)!;
			const existing = actionMap.get(name) || { conversions: 0, conversionValue: 0 };
			existing.conversions += Number(row.metrics?.conversions || 0);
			existing.conversionValue += Number(row.metrics?.conversions_value || 0);
			actionMap.set(name, existing);
		}

		const result = new Map<string, GoogleAdsConversionAction[]>();
		for (const [campaignId, actionMap] of byCampaign) {
			result.set(campaignId, Array.from(actionMap.entries())
				.map(([name, data]) => ({ name, conversions: Math.round(data.conversions), conversionValue: data.conversionValue }))
				.sort((a, b) => b.conversions - a.conversions)
			);
		}
		return result;
	} catch {
		return new Map();
	}
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

export interface GoogleAdsGeographicInsight {
	locationId: number;
	locationName: string;
	locationType: string;
	spend: number;
	impressions: number;
	clicks: number;
	results: number;
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
				videoViews: 0,
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
				startDate: null,
				endDate: null,
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
				videoViews: 0,
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
 * Fetch geographic performance breakdown (regions/counties where ads appeared) for a sub-account.
 * Uses geographic_view with segments.geo_target_most_specific_location for granular location data.
 */
export async function listGeographicInsights(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
	startDate: string,
	endDate: string
): Promise<GoogleAdsGeographicInsight[]> {
	logInfo('google-ads', `Fetching geographic insights for ${customerId}`, { metadata: { startDate, endDate } });

	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		// geographic_view with geo_target_most_specific_location gives the most granular
		// location where ads appeared (city/region level)
		const geoResults = await customer.query(`
			SELECT segments.geo_target_most_specific_location,
				metrics.cost_micros,
				metrics.impressions,
				metrics.clicks,
				metrics.conversions
			FROM geographic_view
			WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
		`);

		logInfo('google-ads', `Geographic query returned ${geoResults.length} rows for ${customerId}`);

		// Aggregate by geo_target resource name (e.g. "geoTargetConstants/1014044")
		const locationMap = new Map<string, { spend: number; impressions: number; clicks: number; results: number }>();
		for (const row of geoResults) {
			const geoConstant = String(row.segments?.geo_target_most_specific_location || '');
			if (!geoConstant || geoConstant === 'undefined') continue;
			const existing = locationMap.get(geoConstant) || { spend: 0, impressions: 0, clicks: 0, results: 0 };
			existing.spend += Number(row.metrics?.cost_micros || 0) / 1_000_000;
			existing.impressions += Number(row.metrics?.impressions || 0);
			existing.clicks += Number(row.metrics?.clicks || 0);
			existing.results += Math.round(Number(row.metrics?.conversions || 0));
			locationMap.set(geoConstant, existing);
		}

		if (locationMap.size === 0) return [];

		// Sort by spend and take top 50 locations to avoid excessive API calls
		const topLocations = Array.from(locationMap.entries())
			.sort((a, b) => b[1].spend - a[1].spend)
			.slice(0, 50);

		// Resolve location names — query individually (GAQL doesn't support OR/IN on resource_name)
		const nameMap = new Map<string, { name: string; targetType: string }>();
		// Run lookups in parallel batches of 10 for speed
		for (let i = 0; i < topLocations.length; i += 10) {
			const batch = topLocations.slice(i, i + 10);
			await Promise.all(batch.map(async ([resourceName]) => {
				try {
					const constants = await customer.query(`
						SELECT geo_target_constant.id,
							geo_target_constant.name,
							geo_target_constant.canonical_name,
							geo_target_constant.target_type
						FROM geo_target_constant
						WHERE geo_target_constant.resource_name = '${resourceName}'
					`);
					if (constants.length > 0) {
						const gc = constants[0];
						nameMap.set(resourceName, {
							name: gc.geo_target_constant?.name || gc.geo_target_constant?.canonical_name || resourceName,
							targetType: String(gc.geo_target_constant?.target_type || '')
						});
					}
				} catch {
					const match = resourceName.match(/(\d+)$/);
					nameMap.set(resourceName, { name: match ? `Location ${match[1]}` : resourceName, targetType: '' });
				}
			}));
		}

		// Build results, filtering out countries and postal codes
		// Aggregate by resolved location name to merge different geo_target IDs for the same city/region
		const aggregatedMap = new Map<string, GoogleAdsGeographicInsight>();
		for (const [resourceName, data] of topLocations) {
			const info = nameMap.get(resourceName);
			if (info?.targetType === 'Country' || info?.targetType === 'Postal Code') continue;
			if (info?.name && /^\d+$/.test(info.name)) continue;
			const locationName = info?.name || resourceName;
			const key = locationName.toLowerCase();
			const existing = aggregatedMap.get(key);
			if (existing) {
				existing.spend += data.spend;
				existing.impressions += data.impressions;
				existing.clicks += data.clicks;
				existing.results += data.results;
			} else {
				const match = resourceName.match(/(\d+)$/);
				aggregatedMap.set(key, {
					locationId: match ? Number(match[1]) : 0,
					locationName,
					locationType: info?.targetType || 'REGION',
					spend: data.spend,
					impressions: data.impressions,
					clicks: data.clicks,
					results: data.results
				});
			}
		}
		const results = Array.from(aggregatedMap.values()).sort((a, b) => b.spend - a.spend);

		logInfo('google-ads', `Geographic insights loaded for ${customerId}`, {
			metadata: { locations: results.length }
		});
		return results;
	} catch (err) {
		logError('google-ads', `Failed to fetch geographic insights for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500) }
		});
		return [];
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

/**
 * Fetch the most recent billing_setup status for a given sub-account.
 * Returns 'APPROVED' | 'CANCELLED' | 'PENDING' | 'NONE' (no billing setup) | null (error).
 */
export async function fetchBillingSetupStatus(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string
): Promise<string | null> {
	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);

		const rows = await customer.query(`
			SELECT billing_setup.id, billing_setup.status
			FROM billing_setup
		`);

		if (!rows || rows.length === 0) return 'NONE';

		// Google Ads BillingSetupStatus enum (verified against official docs):
		//   0 UNSPECIFIED, 1 UNKNOWN, 2 PENDING, 3 APPROVED_HELD, 4 APPROVED, 5 CANCELLED
		// Previous mapping had 3:APPROVED, 4:CANCELLED — this caused legitimately
		// APPROVED accounts (enum=4) to be flagged as CANCELLED → payment_failed
		// emails. Fixed 2026-04-22.
		const statusMap: Record<number, string> = {
			2: 'PENDING',
			3: 'APPROVED_HELD',
			4: 'APPROVED',
			5: 'CANCELLED',
		};

		const statuses = (rows as any[])
			.map((r) => statusMap[r.billing_setup?.status] || null)
			.filter(Boolean) as string[];

		// Precedence for multiple setups on one account: prefer the best status.
		if (statuses.includes('APPROVED')) return 'APPROVED';
		if (statuses.includes('APPROVED_HELD')) return 'APPROVED_HELD';
		if (statuses.includes('PENDING')) return 'PENDING';
		if (statuses.includes('CANCELLED')) return 'CANCELLED';
		return 'NONE';
	} catch (err) {
		logWarning('google-ads', `Failed to fetch billing_setup for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
		return null;
	}
}

/**
 * Fetch the `customer.suspension_reasons` array for a specific sub-account.
 * Returns a string[] of enum labels (normalized to uppercase names) or [] if
 * none present. Returns null on error (treated downstream as "unknown, don't
 * override existing decision").
 *
 * Google Ads API CustomerStatusEnum.SuspensionReason (verified 2026-04-24):
 *   0 UNSPECIFIED · 1 UNKNOWN · 2 SUSPICIOUS_PAYMENT_ACTIVITY
 *   3 CIRCUMVENTING_SYSTEMS · 4 MISREPRESENTATION · 5 UNPAID_BALANCE
 *   6 UNACCEPTABLE_BUSINESS_PRACTICES · 7 UNAUTHORIZED_ACCOUNT_ACTIVITY
 *
 * The google-ads-api lib may return either numeric or string enums; handle both.
 * Unknown enum values are logged via logWarning so we update the translator
 * before clients hit the generic fallback ("motiv nespecificat").
 */
export async function fetchCustomerSuspensionReasons(
	mccAccountId: string,
	customerId: string,
	developerToken: string,
	refreshToken: string,
): Promise<string[] | null> {
	const numericToString: Record<number, string> = {
		0: 'UNSPECIFIED',
		1: 'UNKNOWN',
		2: 'SUSPICIOUS_PAYMENT_ACTIVITY',
		3: 'CIRCUMVENTING_SYSTEMS',
		4: 'MISREPRESENTATION',
		5: 'UNPAID_BALANCE',
		6: 'UNACCEPTABLE_BUSINESS_PRACTICES',
		7: 'UNAUTHORIZED_ACCOUNT_ACTIVITY',
	};
	const KNOWN = new Set([
		'SUSPICIOUS_PAYMENT_ACTIVITY',
		'CIRCUMVENTING_SYSTEMS',
		'MISREPRESENTATION',
		'UNPAID_BALANCE',
		'UNACCEPTABLE_BUSINESS_PRACTICES',
		'UNAUTHORIZED_ACCOUNT_ACTIVITY',
		'UNKNOWN',
		'UNSPECIFIED',
	]);
	try {
		const customer = getSubAccountClient(mccAccountId, customerId, developerToken, refreshToken);
		const rows = await customer.query(`
			SELECT customer.suspension_reasons
			FROM customer
			LIMIT 1
		`);
		if (!rows || rows.length === 0) return [];
		const raw = (rows[0] as any).customer?.suspension_reasons ?? [];
		if (!Array.isArray(raw)) return [];
		return raw
			.map((r: unknown) =>
				// Unmapped numeric codes get tagged with their value (e.g. CODE_8) so
				// they trip the unknown-enum logWarning below instead of being
				// silently collapsed into 'UNKNOWN' (which IS a known enum).
				typeof r === 'number' ? (numericToString[r] ?? `CODE_${r}`) : String(r).toUpperCase(),
			)
			.filter((s: string) => {
				if (!KNOWN.has(s)) {
					logWarning('google-ads', 'Unknown Google suspension_reasons enum', {
						metadata: { reason: s, customerId },
					});
				}
				return s !== 'UNSPECIFIED';
			});
	} catch (err) {
		logWarning('google-ads', `Failed to fetch customer.suspension_reasons for ${customerId}`, {
			metadata: { error: err instanceof Error ? err.message : String(err) },
		});
		return null;
	}
}
