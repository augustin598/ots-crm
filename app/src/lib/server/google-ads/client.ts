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
			metadata: { mcc: cleanMcc, error: err instanceof Error ? err.message : String(err) }
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
			metadata: { mcc: cleanMcc, error: err instanceof Error ? err.message : String(err) }
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
