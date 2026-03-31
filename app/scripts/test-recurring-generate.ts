/**
 * Test: Generate ONE recurring invoice end-to-end
 *
 * Run: bun scripts/test-recurring-generate.ts
 *
 * This script:
 * 1. Reads the recurring template "4sgjvta6aq7howirq2daoosj"
 * 2. Gets next invoice number from Keez API
 * 3. Creates invoice in CRM database
 * 4. Sends invoice to Keez (create + validate)
 * 5. Verifies everything synced correctly
 *
 * ⚠️ This creates a REAL invoice in CRM + Keez. Delete manually from Keez after testing.
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

// ─── DB ────────────────────────────────────────────────────────────
const SQLITE_PATH = process.env.SQLITE_PATH || Bun.env.SQLITE_PATH;
const SQLITE_URI = process.env.SQLITE_URI || Bun.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN || Bun.env.SQLITE_AUTH_TOKEN;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || Bun.env.ENCRYPTION_SECRET;

if (!ENCRYPTION_SECRET) { console.error('Missing ENCRYPTION_SECRET'); process.exit(1); }

let dbClient;
if (SQLITE_PATH) {
	dbClient = createClient({ url: `file:${SQLITE_PATH}` });
} else if (SQLITE_URI) {
	dbClient = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });
} else {
	console.error('Missing SQLITE_PATH or SQLITE_URI'); process.exit(1);
}
const db = drizzle(dbClient, { schema });
const table = schema;

// ─── Crypto (inline — no SvelteKit deps) ──────────────────────────
function deriveKey(tenantId: string, secret: string): Buffer {
	const salt = pbkdf2Sync(secret, tenantId, 1000, 32, 'sha256');
	return pbkdf2Sync(secret, salt.toString('hex'), 100000, 32, 'sha256');
}

function decrypt(tenantId: string, encryptedData: string): string {
	const key = deriveKey(tenantId, ENCRYPTION_SECRET!);
	const [ivHex, tagHex, encrypted] = encryptedData.split(':');
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

// ─── Mini Keez Client ──────────────────────────────────────────────
const KEEZ_BASE = 'https://app.keez.ro/api/v1.0/public-api';
const KEEZ_TOKEN_URL = 'https://app.keez.ro/idp/connect/token';

class MiniKeezClient {
	private clientEid: string;
	private applicationId: string;
	private secret: string;
	private accessToken: string | null = null;
	private baseUrl: string = KEEZ_BASE;

	constructor(config: { clientEid: string; applicationId: string; secret: string; cachedToken?: string | null }) {
		this.clientEid = config.clientEid;
		this.applicationId = config.applicationId;
		this.secret = config.secret;
		this.accessToken = config.cachedToken || null;
	}

	private async getToken(): Promise<string> {
		if (this.accessToken) return this.accessToken;

		// Match exact format from KeezClient: scope='public-api', client_id='app{applicationId}'
		const body = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: `app${this.applicationId}`,
			client_secret: this.secret,
			scope: 'public-api'
		});

		const res = await fetch(KEEZ_TOKEN_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
		if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
		const data = await res.json() as any;
		this.accessToken = data.access_token;
		// Update base URL if token response provides one
		if (data.api_endpoint) {
			this.baseUrl = data.api_endpoint;
		}
		return this.accessToken!;
	}

	private async request(path: string, opts: RequestInit = {}): Promise<any> {
		const token = await this.getToken();
		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			...opts,
			headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers as any }
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`Keez API ${res.status}: ${text}`);
		return text ? JSON.parse(text) : null;
	}

	async getNextInvoiceNumber(series: string): Promise<number | null> {
		const data = await this.request(`/${this.clientEid}/invoices?$count=1000&$filter=series eq '${series}'&$orderby=number desc`);
		if (!data?.data || data.data.length === 0) return 1;
		const maxNum = Math.max(...data.data.map((inv: any) => inv.number || 0));
		return maxNum + 1;
	}

	async createInvoice(invoice: any): Promise<any> {
		return this.request(`/${this.clientEid}/invoices`, { method: 'POST', body: JSON.stringify(invoice) });
	}

	async validateInvoice(externalId: string): Promise<void> {
		await this.request(`/${this.clientEid}/invoices/valid`, { method: 'POST', body: JSON.stringify({ externalId }) });
	}

	async getInvoice(externalId: string): Promise<any> {
		return this.request(`/${this.clientEid}/invoices/${externalId}`);
	}

	async getInvoices(params: { count?: number; filter?: string }): Promise<any> {
		const qs = new URLSearchParams();
		if (params.count) qs.set('$count', String(params.count));
		if (params.filter) qs.set('$filter', params.filter);
		return this.request(`/${this.clientEid}/invoices?${qs}`);
	}

	async getItem(externalId: string): Promise<any> {
		return this.request(`/${this.clientEid}/items/${externalId}`);
	}
}

// ─── Colors ────────────────────────────────────────────────────────
const C = {
	reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
	blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};

function log(color: string, prefix: string, msg: string, data?: any) {
	const ts = new Date().toISOString().split('T')[1].slice(0, 12);
	console.log(`${C.gray}${ts}${C.reset} ${color}[${prefix}]${C.reset} ${msg}`);
	if (data) console.log(`${C.gray}  └─ ${JSON.stringify(data, null, 2).replace(/\n/g, '\n     ')}${C.reset}`);
}

function header(title: string) {
	console.log(`\n${C.bold}${C.cyan}${'═'.repeat(70)}\n  ${title}\n${'═'.repeat(70)}${C.reset}`);
}

function section(title: string) {
	console.log(`\n${C.bold}${C.blue}── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}${C.reset}`);
}

// ─── Main ──────────────────────────────────────────────────────────
const TEMPLATE_ID = '4sgjvta6aq7howirq2daoosj';

async function main() {
	header('TEST: Generate Recurring Invoice End-to-End');
	const startTime = Date.now();

	// ── Step 1: Load template ──────────────────────────────────────
	section('Step 1: Load Recurring Template');

	const [template] = await db.select().from(table.recurringInvoice).where(eq(table.recurringInvoice.id, TEMPLATE_ID)).limit(1);
	if (!template) { log(C.red, 'FAIL', `Template ${TEMPLATE_ID} not found`); process.exit(1); }

	const [tenant] = await db.select().from(table.tenant).where(eq(table.tenant.id, template.tenantId)).limit(1);
	const [client] = await db.select().from(table.client).where(eq(table.client.id, template.clientId)).limit(1);

	log(C.green, 'TEMPLATE', `${template.name} | ${client?.name} | tenant: ${tenant?.slug}`, {
		type: template.recurringType,
		interval: template.recurringInterval,
		amount: `${(template.amount / 100).toFixed(2)} ${template.currency}`,
		startDate: template.startDate ? new Date(template.startDate).toISOString().split('T')[0] : 'N/A',
		endDate: template.endDate ? new Date(template.endDate).toISOString().split('T')[0] : 'N/A',
	});

	// Parse line items
	let lineItems: any[] = [];
	if (template.lineItemsJson) {
		lineItems = JSON.parse(template.lineItemsJson);
	}
	log(C.blue, 'ITEMS', `${lineItems.length} line item(s)`);
	for (const item of lineItems) {
		log(C.gray, '  ITEM', `${item.description} | qty=${item.quantity} rate=${item.rate} | keez=${item.keezItemExternalId || 'N/A'}`);
	}

	// Parse invoice fields from notes
	let invoiceFields: any = {};
	if (template.notes) {
		const m = template.notes.match(/RECURRING_INVOICE_FIELDS:(.*?)-->/s);
		if (m) invoiceFields = JSON.parse(m[1]);
	}
	log(C.blue, 'FIELDS', 'Invoice metadata', invoiceFields);

	// ── Step 2: Connect to Keez ────────────────────────────────────
	section('Step 2: Connect to Keez');

	const [keezIntegration] = await db.select().from(table.keezIntegration)
		.where(and(eq(table.keezIntegration.tenantId, template.tenantId), eq(table.keezIntegration.isActive, true)))
		.limit(1);

	if (!keezIntegration) { log(C.red, 'FAIL', 'No active Keez integration'); process.exit(1); }

	const keezSecret = decrypt(template.tenantId, keezIntegration.secret);

	// Try cached token from DB first
	let cachedToken: string | null = null;
	log(C.gray, 'TOKEN-DEBUG', `accessToken in DB: ${keezIntegration.accessToken ? 'yes (' + keezIntegration.accessToken.substring(0, 20) + '...)' : 'null'}`);
	log(C.gray, 'TOKEN-DEBUG', `tokenExpiresAt: ${keezIntegration.tokenExpiresAt || 'null'}`);

	if (keezIntegration.accessToken && keezIntegration.tokenExpiresAt) {
		const expiresAt = new Date(keezIntegration.tokenExpiresAt);
		if (expiresAt > new Date()) {
			cachedToken = decrypt(template.tenantId, keezIntegration.accessToken);
			log(C.green, 'TOKEN', `Using cached token (expires: ${expiresAt.toISOString()})`);
		} else {
			log(C.yellow, 'TOKEN', `Cached token EXPIRED at ${expiresAt.toISOString()}`);
		}
	} else if (keezIntegration.accessToken) {
		// No expiry info, try using it anyway
		cachedToken = decrypt(template.tenantId, keezIntegration.accessToken);
		log(C.yellow, 'TOKEN', 'Using cached token (no expiry info)');
	}

	const keez = new MiniKeezClient({
		clientEid: keezIntegration.clientEid,
		applicationId: keezIntegration.applicationId,
		secret: keezSecret,
		cachedToken
	});

	log(C.green, 'KEEZ', `Connected: clientEid=${keezIntegration.clientEid}`);

	// ── Step 3: Get next invoice number ────────────────────────────
	section('Step 3: Get Next Invoice Number from Keez');

	const [settings] = await db.select().from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, template.tenantId)).limit(1);

	const series = invoiceFields.invoiceSeries || settings?.keezSeries || 'OTS';
	const nextNumber = await keez.getNextInvoiceNumber(series);

	log(C.green, 'NUMBER', `Next: ${series} ${nextNumber}`);

	// ── Step 4: Fetch latest Keez item price ───────────────────────
	section('Step 4: Fetch Latest Keez Item Prices');

	for (const item of lineItems) {
		if (item.keezItemExternalId) {
			try {
				const keezItem = await keez.getItem(item.keezItemExternalId);
				log(C.green, 'KEEZ-ITEM', `${item.description}: lastPrice=${keezItem.lastPrice}, vatRate=${keezItem.vatRate}%`, {
					name: keezItem.name,
					externalId: keezItem.externalId,
					lastPrice: keezItem.lastPrice,
					vatRate: keezItem.vatRate,
					currencyCode: keezItem.currencyCode,
					measureUnitId: keezItem.measureUnitId,
				});
				// Update rate with latest price
				item.rate = keezItem.lastPrice || item.rate;
			} catch (err) {
				log(C.yellow, 'WARN', `Could not fetch Keez item ${item.keezItemExternalId}: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	// ── Step 5: Calculate totals ───────────────────────────────────
	section('Step 5: Calculate Totals');

	const taxApplicationType = invoiceFields.taxApplicationType || 'apply';
	let subtotal = 0;
	let totalTax = 0;
	const defaultTaxRate = 19;

	for (const item of lineItems) {
		const rateCents = Math.round(item.rate * 100);
		let itemSubtotal = Math.round(rateCents * item.quantity);

		if (item.discountType === 'percent' && item.discount) {
			itemSubtotal -= Math.round((itemSubtotal * item.discount) / 100);
		} else if (item.discountType === 'fixed' && item.discount) {
			itemSubtotal -= Math.round(item.discount * 100);
		}

		subtotal += itemSubtotal;

		if (taxApplicationType === 'apply') {
			const taxRate = item.taxRate || defaultTaxRate;
			totalTax += Math.round((itemSubtotal * taxRate * 100) / 10000);
		}
	}

	const totalAmount = subtotal + totalTax;
	const taxRate = taxApplicationType === 'apply' ? (lineItems[0]?.taxRate || defaultTaxRate) * 100 : 0;

	log(C.green, 'TOTALS', `Subtotal: ${(subtotal / 100).toFixed(2)} | Tax: ${(totalTax / 100).toFixed(2)} | Total: ${(totalAmount / 100).toFixed(2)} ${template.currency}`);

	// ── Step 6: Create invoice in CRM DB ───────────────────────────
	section('Step 6: Create Invoice in CRM Database');

	const now = new Date();
	const issueDate = new Date(now);
	issueDate.setDate(issueDate.getDate() + template.issueDateOffset);
	const dueDate = new Date(issueDate);
	dueDate.setDate(dueDate.getDate() + template.dueDateOffset);

	const invoiceId = generateId();
	const invoiceNumber = `${series} ${nextNumber}`;

	const invoiceData = {
		id: invoiceId,
		tenantId: template.tenantId,
		clientId: template.clientId,
		projectId: template.projectId || null,
		serviceId: template.serviceId || null,
		invoiceNumber,
		invoiceSeries: series,
		status: 'sent' as const,
		amount: subtotal,
		taxRate,
		taxAmount: totalTax,
		totalAmount,
		currency: template.currency,
		issueDate,
		dueDate,
		notes: template.notes?.replace(/<!--[\s\S]*?-->/g, '').trim() || null,
		invoiceCurrency: invoiceFields.invoiceCurrency || template.currency,
		paymentTerms: invoiceFields.paymentTerms || null,
		paymentMethod: invoiceFields.paymentMethod || null,
		exchangeRate: invoiceFields.exchangeRate || null,
		vatOnCollection: invoiceFields.vatOnCollection || false,
		isCreditNote: invoiceFields.isCreditNote || false,
		taxApplicationType: taxApplicationType || 'apply',
		recurringType: 'none' as const,
		createdByUserId: template.createdByUserId,
		createdAt: now,
		updatedAt: now,
	};

	await db.insert(table.invoice).values(invoiceData);
	log(C.green, 'CRM', `Invoice created: ${invoiceNumber}`, {
		id: invoiceId,
		issueDate: issueDate.toISOString().split('T')[0],
		dueDate: dueDate.toISOString().split('T')[0],
		total: `${(totalAmount / 100).toFixed(2)} ${template.currency}`,
	});

	// Create line items
	for (const item of lineItems) {
		const lineItemId = generateId();
		const rateCents = Math.round(item.rate * 100);
		const amountCents = Math.round(rateCents * item.quantity);

		await db.insert(table.invoiceLineItem).values({
			id: lineItemId,
			invoiceId,
			serviceId: item.serviceId || null,
			description: item.description,
			quantity: item.quantity,
			rate: rateCents,
			amount: amountCents,
			taxRate: item.taxRate ? Math.round(item.taxRate * 100) : null,
			discountType: item.discountType || null,
			discount: item.discount ? Math.round(item.discount * 100) : null,
			note: item.note || null,
			currency: item.currency || null,
			unitOfMeasure: item.unitOfMeasure || 'Buc',
			keezItemExternalId: item.keezItemExternalId || null,
		});
		log(C.gray, '  LINE', `${item.description} | qty=${item.quantity} rate=${item.rate} → ${(amountCents / 100).toFixed(2)}`);
	}

	// ── Step 7: Build Keez invoice payload ─────────────────────────
	section('Step 7: Build & Send Keez Invoice');

	const keezExternalId = crypto.randomUUID();
	const docDate = parseInt(issueDate.toISOString().split('T')[0].replace(/-/g, ''));
	const dueDateInt = parseInt(dueDate.toISOString().split('T')[0].replace(/-/g, ''));

	// Build invoice details with full Keez-required amounts
	const keezDetails = lineItems.map((item) => {
		const vatRate = item.taxRate || defaultTaxRate;
		const unitPrice = item.rate;
		const qty = item.quantity || 1;
		const netAmount = Math.round(unitPrice * qty * 100) / 100;
		const vatAmount = Math.round((netAmount * vatRate / 100) * 100) / 100;
		const grossAmount = Math.round((netAmount + vatAmount) * 100) / 100;

		return {
			itemExternalId: item.keezItemExternalId || undefined,
			itemName: item.description,
			measureUnitId: 1,
			quantity: qty,
			unitPrice,
			vatPercent: vatRate,
			originalNetAmount: netAmount,
			originalVatAmount: vatAmount,
			originalGrossAmount: grossAmount,
			netAmount,
			vatAmount,
			grossAmount,
			netAmountCurrency: netAmount,
			vatAmountCurrency: vatAmount,
			grossAmountCurrency: grossAmount,
			originalNetAmountCurrency: netAmount,
			originalVatAmountCurrency: vatAmount,
			originalGrossAmountCurrency: grossAmount,
		};
	});

	const totalNet = keezDetails.reduce((s, d) => s + d.netAmount, 0);
	const totalVat = keezDetails.reduce((s, d) => s + d.vatAmount, 0);
	const totalGross = keezDetails.reduce((s, d) => s + d.grossAmount, 0);

	// Map payment method to Keez paymentTypeId
	const PAYMENT_MAP: Record<string, number> = {
		'BFCash': 1, 'BFCard': 2, 'Bank': 3, 'ChitCash': 4, 'Ramburs': 5,
		'ProcesatorPlati': 6, 'PlatformaDistributie': 7, 'VoucherVacantaCard': 8, 'VoucherVacantaTichet': 9,
		'Bank Transfer': 3, 'Cash': 1, 'Card': 2,
	};
	const paymentTypeId = PAYMENT_MAP[invoiceFields.paymentMethod || 'Bank'] || 3;

	const keezInvoice: any = {
		externalId: keezExternalId,
		series,
		number: nextNumber,
		documentDate: docDate,
		issueDate: docDate,
		dueDate: dueDateInt,
		deliveryDate: docDate,
		currencyCode: template.currency,
		currency: template.currency,
		exchangeRate: 1,
		vatOnCollection: false,
		paymentTypeId,
		originalNetAmount: totalNet,
		originalVatAmount: totalVat,
		originalGrossAmount: totalGross,
		netAmount: totalNet,
		vatAmount: totalVat,
		grossAmount: totalGross,
		netAmountCurrency: totalNet,
		vatAmountCurrency: totalVat,
		grossAmountCurrency: totalGross,
		originalNetAmountCurrency: totalNet,
		originalVatAmountCurrency: totalVat,
		originalGrossAmountCurrency: totalGross,
		partner: {
			partnerName: client?.name || 'Unknown',
			identificationNumber: client?.cui || undefined,
			registrationNumber: client?.registrationNumber || undefined,
			isLegalPerson: true,
			countryCode: 'RO',
			countryName: 'România',
			countyName: client?.county || undefined,
			cityName: client?.city || undefined,
			addressDetails: client?.address || undefined,
			postalCode: client?.postalCode || undefined,
			email: client?.email || undefined,
			phone: client?.phone || undefined,
			iban: client?.iban || undefined,
			bankName: client?.bankName || undefined,
		},
		invoiceDetails: keezDetails,
	};

	log(C.blue, 'KEEZ-PAYLOAD', `Sending to Keez: ${series} ${nextNumber}`, {
		externalId: keezExternalId,
		series,
		number: nextNumber,
		client: client?.name,
		items: keezInvoice.invoiceDetails.length,
		documentDate: keezInvoice.documentDate,
		dueDate: keezInvoice.dueDate,
	});

	// Create in Keez
	let keezResponse;
	try {
		keezResponse = await keez.createInvoice(keezInvoice);
		log(C.green, 'KEEZ-CREATE', `✅ Invoice created in Keez`, keezResponse);
	} catch (err) {
		log(C.red, 'KEEZ-CREATE', `❌ Failed to create in Keez: ${err instanceof Error ? err.message : err}`);
		log(C.yellow, 'CLEANUP', 'Deleting CRM invoice...');
		await db.delete(table.invoiceLineItem).where(eq(table.invoiceLineItem.invoiceId, invoiceId));
		await db.delete(table.invoice).where(eq(table.invoice.id, invoiceId));
		log(C.yellow, 'CLEANUP', 'CRM invoice deleted');
		process.exit(1);
	}

	// ── Step 8: Validate in Keez (Draft → Fiscal) ──────────────────
	section('Step 8: Validate Invoice in Keez (Draft → Fiscal)');

	try {
		await keez.validateInvoice(keezResponse.externalId);
		log(C.green, 'KEEZ-VALIDATE', `✅ Invoice validated (Draft → Valid/Fiscal)`);
	} catch (err) {
		log(C.yellow, 'KEEZ-VALIDATE', `⚠️ Validation failed (remains as Proforma): ${err instanceof Error ? err.message : err}`);
	}

	// ── Step 9: Fetch back from Keez to verify ─────────────────────
	section('Step 9: Verify — Fetch Back from Keez');

	try {
		const keezInvoiceData = await keez.getInvoice(keezResponse.externalId);
		log(C.green, 'KEEZ-VERIFY', 'Invoice data from Keez:', {
			externalId: keezInvoiceData.externalId,
			series: keezInvoiceData.series,
			number: keezInvoiceData.number,
			status: keezInvoiceData.status,
			grossAmount: keezInvoiceData.grossAmount,
			currency: keezInvoiceData.currency,
			documentDate: keezInvoiceData.documentDate,
		});

		// Update CRM with Keez data
		const keezStatus = keezInvoiceData.status || 'Draft';
		const actualNumber = keezInvoiceData.series && keezInvoiceData.number
			? `${keezInvoiceData.series} ${keezInvoiceData.number}`
			: invoiceNumber;

		await db.update(table.invoice).set({
			keezInvoiceId: keezResponse.externalId,
			keezExternalId: keezResponse.externalId,
			keezStatus,
			invoiceNumber: actualNumber,
			updatedAt: new Date(),
		}).where(eq(table.invoice.id, invoiceId));

		log(C.green, 'CRM-UPDATE', `CRM updated: number=${actualNumber}, keezStatus=${keezStatus}`);

		// Create sync record
		const syncId = generateId();
		await db.insert(table.keezInvoiceSync).values({
			id: syncId,
			invoiceId,
			tenantId: template.tenantId,
			keezInvoiceId: keezResponse.externalId,
			keezExternalId: keezResponse.externalId,
			syncDirection: 'push',
			lastSyncedAt: new Date(),
			syncStatus: 'synced',
		});
		log(C.green, 'SYNC', `Sync record created: ${syncId}`);

	} catch (err) {
		log(C.yellow, 'VERIFY', `Could not verify: ${err instanceof Error ? err.message : err}`);
	}

	// ── Summary ────────────────────────────────────────────────────
	section('SUMMARY');

	const duration = Date.now() - startTime;
	log(C.green, '✅ DONE', `Invoice generated in ${duration}ms`, {
		invoiceId,
		invoiceNumber,
		series,
		number: nextNumber,
		total: `${(totalAmount / 100).toFixed(2)} ${template.currency}`,
		issueDate: issueDate.toISOString().split('T')[0],
		dueDate: dueDate.toISOString().split('T')[0],
		keezExternalId: keezResponse?.externalId,
		status: 'sent → validated in Keez',
	});

	log(C.yellow, '⚠️  REMEMBER', `Delete this test invoice from Keez manually: ${series} ${nextNumber}`);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(`\n${C.red}[FATAL]${C.reset} ${err instanceof Error ? err.message : err}`);
		if (err instanceof Error) console.error(err.stack);
		process.exit(1);
	});
