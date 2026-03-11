import { logInfo, logError } from '$lib/server/logger';

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

export interface MetaAdsInvoiceData {
	/** Internal ID (numeric string) */
	invoiceId: string;
	/** Actual invoice number (invoice_id field from API) */
	invoiceNumber: string | null;
	invoiceDate: string | null;
	dueDate: string | null;
	/** Amount as string from API (e.g. "123.45") */
	amount: string;
	currencyCode: string;
	paymentStatus: string | null;
	invoiceType: string;
	billingPeriod: string | null;
	downloadUri: string | null;
	cdnDownloadUri: string | null;
	/** Ad account IDs covered by this invoice */
	adAccountIds: string[];
}

export interface MetaAdsAdAccount {
	adAccountId: string; // e.g. act_XXXXXXXXX
	accountName: string;
	accountStatus: number; // 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, etc.
	isActive: boolean;
}

/**
 * List all ad accounts owned by a Business Manager
 */
export async function listBusinessAdAccounts(
	businessId: string,
	accessToken: string
): Promise<MetaAdsAdAccount[]> {
	console.log('[META-ADS CLIENT] listBusinessAdAccounts called', { businessId });
	logInfo('meta-ads', `Listing ad accounts for BM`, { metadata: { businessId } });

	const accounts: MetaAdsAdAccount[] = [];
	let url: string | null = `${META_GRAPH_URL}/${businessId}/owned_ad_accounts?fields=id,name,account_status&limit=100&access_token=${accessToken}`;

	try {
		while (url) {
			const res = await fetch(url);
			const data = await res.json();
			console.log('[META-ADS CLIENT] Ad accounts response', { hasError: !!data.error, dataCount: data.data?.length || 0, hasNext: !!data.paging?.next });

			if (data.error) {
				console.error('[META-ADS CLIENT] Ad accounts API error', data.error);
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			if (data.data?.[0]) {
				console.log('[META-ADS CLIENT] Sample ad account', JSON.stringify(data.data[0]));
			}

			for (const acc of data.data || []) {
				accounts.push({
					adAccountId: acc.id || '',
					accountName: acc.name || '',
					accountStatus: acc.account_status || 0,
					isActive: acc.account_status === 1
				});
			}

			// Cursor-based pagination
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
 * List invoices at Business Manager level
 */
export async function listBusinessInvoices(
	businessId: string,
	accessToken: string,
	startDate?: string,
	endDate?: string
): Promise<MetaAdsInvoiceData[]> {
	console.log('[META-ADS CLIENT] listBusinessInvoices called', { businessId, startDate, endDate });
	logInfo('meta-ads', `Listing BM invoices`, { metadata: { businessId, startDate, endDate } });

	const invoices: MetaAdsInvoiceData[] = [];
	const fields = 'id,invoice_id,invoice_date,due_date,amount,currency,payment_status,invoice_type,billing_period,download_uri,cdn_download_uri,ad_account_ids';

	let baseUrl = `${META_GRAPH_URL}/${businessId}/business_invoices?fields=${fields}&limit=100&access_token=${accessToken}`;
	if (startDate) baseUrl += `&start_date=${startDate}`;
	if (endDate) baseUrl += `&end_date=${endDate}`;

	// Log request URL (without access_token for security)
	const debugUrl = baseUrl.replace(/access_token=[^&]+/, 'access_token=REDACTED');
	logInfo('meta-ads', `Requesting invoices`, { metadata: { url: debugUrl } });

	let url: string | null = baseUrl;
	let isFirstPage = true;

	try {
		while (url) {
			console.log('[META-ADS CLIENT] Fetching invoices page...');
			const res = await fetch(url);
			console.log('[META-ADS CLIENT] Invoices response status', { status: res.status, ok: res.ok });
			const data = await res.json();
			console.log('[META-ADS CLIENT] Invoices response parsed', { hasError: !!data.error, dataCount: data.data?.length || 0, hasNext: !!data.paging?.next, rawKeys: Object.keys(data) });

			if (data.error) {
				console.error('[META-ADS CLIENT] Invoices API error', JSON.stringify(data.error));
				logError('meta-ads', `API error response`, {
					metadata: { errorMessage: data.error.message, errorCode: data.error.code, errorType: data.error.type }
				});
				throw new Error(`Meta API error: ${data.error.message}`);
			}

			// Log raw response on first page for debugging
			if (isFirstPage && data.data?.length > 0) {
				const sample = data.data[0];
				console.log('[META-ADS CLIENT] FIRST INVOICE RAW DATA:', JSON.stringify(sample));
				logInfo('meta-ads', `Raw invoice sample`, {
					metadata: {
						keys: Object.keys(sample),
						id: sample.id,
						amount: sample.amount,
						amountType: typeof sample.amount,
						currency: sample.currency,
						ad_account_ids: sample.ad_account_ids,
						invoice_date: sample.invoice_date
					}
				});
				isFirstPage = false;
			}

			for (const inv of data.data || []) {
				invoices.push({
					invoiceId: inv.id || '',
					invoiceNumber: inv.invoice_id || null,
					invoiceDate: inv.invoice_date || null,
					dueDate: inv.due_date || null,
					amount: String(inv.amount || '0'),
					currencyCode: inv.currency || 'USD',
					paymentStatus: inv.payment_status || null,
					invoiceType: inv.invoice_type || 'INVOICE',
					billingPeriod: inv.billing_period || null,
					downloadUri: inv.download_uri || null,
					cdnDownloadUri: inv.cdn_download_uri || null,
					adAccountIds: inv.ad_account_ids || []
				});
			}

			url = data.paging?.next || null;
		}

		logInfo('meta-ads', `Found ${invoices.length} BM invoices`, { metadata: { businessId } });
		return invoices;
	} catch (err) {
		logError('meta-ads', `Failed to list BM invoices`, {
			metadata: { businessId, error: err instanceof Error ? err.message : String(err) }
		});
		throw err;
	}
}

/**
 * Download an invoice PDF from Meta's download URI
 */
export async function downloadInvoicePdf(downloadUri: string): Promise<Buffer> {
	console.log('[META-ADS CLIENT] downloadInvoicePdf called', { uri: downloadUri.substring(0, 100) + '...' });
	const response = await fetch(downloadUri);
	console.log('[META-ADS CLIENT] PDF download response', { status: response.status, ok: response.ok, contentType: response.headers.get('content-type') });

	if (!response.ok) {
		throw new Error(`Failed to download PDF: ${response.status}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	console.log('[META-ADS CLIENT] PDF downloaded', { size: arrayBuffer.byteLength });
	return Buffer.from(arrayBuffer);
}

/**
 * Get the date range to query for invoice sync (current + previous 2 months)
 */
export function getSyncDateRange(referenceDate?: Date): { startDate: string; endDate: string } {
	const date = referenceDate || new Date();

	// Start: 2 months ago, 1st day
	const startMonth = new Date(date.getFullYear(), date.getMonth() - 2, 1);
	// End: current month, last day
	const endMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

	const formatDate = (d: Date) => d.toISOString().split('T')[0]; // YYYY-MM-DD

	return {
		startDate: formatDate(startMonth),
		endDate: formatDate(endMonth)
	};
}
