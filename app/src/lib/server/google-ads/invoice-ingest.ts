import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { logInfo } from '$lib/server/logger';
import { uploadBuffer } from '$lib/server/storage';
import { parseAmountString } from './invoice-parsing';

/**
 * Single write path for Google Ads invoice PDFs. Used by:
 *  - the server-side downloader (links + stored Google cookies)
 *  - the userscript ingest API (PDF bytes fetched in the user's own browser)
 *
 * Idempotent on (tenantId, googleInvoiceId): re-sending an invoice that already
 * has a PDF is a no-op apart from fixing attribution / backfilling the amount.
 */

export class GoogleAccountNotMappedError extends Error {
	constructor(public readonly customerId: string) {
		super(`Contul Google Ads ${customerId} nu este asociat unui client în CRM`);
		this.name = 'GoogleAccountNotMappedError';
	}
}

/**
 * The userscript guesses the customer id from the page header. If an invoice is
 * already filed under another account we refuse to move it rather than silently
 * re-attributing a client's invoice to someone else.
 */
export class GoogleInvoiceAttributionConflictError extends Error {
	constructor(public readonly invoiceId: string, public readonly storedCustomerId: string, public readonly requestedCustomerId: string) {
		super(`Factura ${invoiceId} este deja înregistrată pe contul ${storedCustomerId}, nu pe ${requestedCustomerId}. Verifică ID-ul contului.`);
		this.name = 'GoogleInvoiceAttributionConflictError';
	}
}

export interface MappedAccount {
	clientId: string;
	accountName: string;
	currencyCode: string;
	clientName: string | null;
}

export interface ExistingInvoice {
	id: string;
	pdfPath: string | null;
	totalAmountMicros: number | null;
	googleAdsCustomerId: string;
	clientId: string;
}

export type IngestSource = 'userscript' | 'server-download';

export interface PersistGoogleInvoiceInput {
	tenantId: string;
	customerId: string;
	invoiceId: string;
	issueDate: Date | null;
	amountText?: string | null;
	pdfBuffer: Buffer;
	source: IngestSource;
}

export interface PersistResult {
	status: 'imported' | 'updated' | 'skipped';
	invoiceRowId: string;
}

const digits = (id: string) => id.trim().replace(/-/g, '');

/** Account row for this tenant, only when it is mapped to a CRM client. */
export async function resolveMappedAccount(tenantId: string, customerId: string): Promise<MappedAccount | null> {
	const cleanId = digits(customerId);
	const [row] = await db
		.select({
			clientId: table.googleAdsAccount.clientId,
			accountName: table.googleAdsAccount.accountName,
			currencyCode: table.googleAdsAccount.currencyCode,
			clientName: table.client.name
		})
		.from(table.googleAdsAccount)
		.leftJoin(table.client, eq(table.googleAdsAccount.clientId, table.client.id))
		.where(and(eq(table.googleAdsAccount.tenantId, tenantId), eq(table.googleAdsAccount.googleAdsCustomerId, cleanId)))
		.limit(1);
	if (!row?.clientId) return null;
	return { clientId: row.clientId, accountName: row.accountName, currencyCode: row.currencyCode || 'USD', clientName: row.clientName ?? null };
}

export async function findExistingInvoice(tenantId: string, invoiceId: string): Promise<ExistingInvoice | null> {
	const [row] = await db
		.select({
			id: table.googleAdsInvoice.id,
			pdfPath: table.googleAdsInvoice.pdfPath,
			totalAmountMicros: table.googleAdsInvoice.totalAmountMicros,
			googleAdsCustomerId: table.googleAdsInvoice.googleAdsCustomerId,
			clientId: table.googleAdsInvoice.clientId
		})
		.from(table.googleAdsInvoice)
		.where(and(eq(table.googleAdsInvoice.tenantId, tenantId), eq(table.googleAdsInvoice.googleInvoiceId, invoiceId)))
		.limit(1);
	return row ?? null;
}

/** Invoice ids (from the given list) that already have a PDF for this tenant. */
export async function listExistingInvoiceIds(tenantId: string, invoiceIds: string[]): Promise<Set<string>> {
	const found = new Set<string>();
	for (let i = 0; i < invoiceIds.length; i += 100) {
		const chunk = invoiceIds.slice(i, i + 100);
		const rows = await db
			.select({ googleInvoiceId: table.googleAdsInvoice.googleInvoiceId })
			.from(table.googleAdsInvoice)
			.where(
				and(
					eq(table.googleAdsInvoice.tenantId, tenantId),
					inArray(table.googleAdsInvoice.googleInvoiceId, chunk),
					isNotNull(table.googleAdsInvoice.pdfPath)
				)
			);
		for (const r of rows) found.add(r.googleInvoiceId);
	}
	return found;
}

/**
 * For an invoice that already has a PDF: fix attribution if the account was
 * reassigned and backfill the amount when we now know it. Returns true when a
 * write happened.
 */
export async function backfillExistingInvoice(params: {
	tenantId: string;
	existing: ExistingInvoice;
	account: MappedAccount;
	customerId: string;
	amountText?: string | null;
}): Promise<boolean> {
	const { existing, account, tenantId } = params;
	const cleanId = digits(params.customerId);
	const fields: Partial<typeof table.googleAdsInvoice.$inferInsert> = {};

	if (existing.googleAdsCustomerId !== cleanId || existing.clientId !== account.clientId) {
		fields.googleAdsCustomerId = cleanId;
		fields.clientId = account.clientId;
	}
	const parsed = parseAmountString(params.amountText);
	if (existing.totalAmountMicros == null && parsed != null) {
		fields.totalAmountMicros = Math.round(parsed * 1_000_000);
	}
	if (Object.keys(fields).length === 0) return false;

	fields.updatedAt = new Date();
	await db.update(table.googleAdsInvoice).set(fields).where(eq(table.googleAdsInvoice.id, existing.id));
	logInfo('google-ads-dl', `Invoice ${existing.id} backfilled`, { tenantId, metadata: { fields: Object.keys(fields) } });
	return true;
}

export async function persistGoogleInvoicePdf(input: PersistGoogleInvoiceInput): Promise<PersistResult> {
	const cleanId = digits(input.customerId);
	const account = await resolveMappedAccount(input.tenantId, cleanId);
	if (!account) throw new GoogleAccountNotMappedError(cleanId);

	const existing = await findExistingInvoice(input.tenantId, input.invoiceId);
	if (existing && input.source === 'userscript' && digits(existing.googleAdsCustomerId) !== cleanId) {
		throw new GoogleInvoiceAttributionConflictError(input.invoiceId, existing.googleAdsCustomerId, cleanId);
	}
	if (existing?.pdfPath) {
		await backfillExistingInvoice({ tenantId: input.tenantId, existing, account, customerId: cleanId, amountText: input.amountText });
		return { status: 'skipped', invoiceRowId: existing.id };
	}

	const upload = await uploadBuffer(
		input.tenantId,
		input.pdfBuffer,
		`google-ads-invoice-${cleanId}_${input.invoiceId}.pdf`,
		'application/pdf',
		{ type: 'google-ads-invoice', customerId: cleanId, invoiceId: input.invoiceId, source: input.source }
	);

	const parsedAmount = parseAmountString(input.amountText);
	const totalAmountMicros = parsedAmount != null ? Math.round(parsedAmount * 1_000_000) : undefined;
	const now = new Date();

	if (existing) {
		await db
			.update(table.googleAdsInvoice)
			.set({
				pdfPath: upload.path,
				status: 'synced',
				syncedAt: now,
				updatedAt: now,
				googleAdsCustomerId: cleanId,
				clientId: account.clientId,
				...(input.issueDate && { issueDate: input.issueDate }),
				...(totalAmountMicros != null && { totalAmountMicros })
			})
			.where(eq(table.googleAdsInvoice.id, existing.id));
		logInfo('google-ads-dl', `Invoice ${input.invoiceId} PDF attached to existing row`, {
			tenantId: input.tenantId,
			metadata: { source: input.source, customerId: cleanId }
		});
		return { status: 'updated', invoiceRowId: existing.id };
	}

	const id = crypto.randomUUID();
	try {
		await db.insert(table.googleAdsInvoice).values({
			id,
			tenantId: input.tenantId,
			clientId: account.clientId,
			googleAdsCustomerId: cleanId,
			googleInvoiceId: input.invoiceId,
			invoiceNumber: input.invoiceId,
			issueDate: input.issueDate ?? now,
			currencyCode: account.currencyCode,
			invoiceType: 'INVOICE',
			pdfPath: upload.path,
			status: 'synced',
			syncedAt: now,
			createdAt: now,
			updatedAt: now,
			...(totalAmountMicros != null && { totalAmountMicros })
		});
	} catch (err) {
		// Lost a race with the monthly cron / another tab on the unique index
		// (tenant_id, google_invoice_id): the invoice exists now, so report it as
		// such instead of failing the whole batch.
		const message = err instanceof Error ? err.message : String(err);
		if (/UNIQUE|constraint/i.test(message)) {
			const raced = await findExistingInvoice(input.tenantId, input.invoiceId);
			if (raced) {
				logInfo('google-ads-dl', `Invoice ${input.invoiceId} was inserted concurrently; keeping the existing row`, {
					tenantId: input.tenantId,
					metadata: { source: input.source, customerId: cleanId, orphanedUpload: upload.path }
				});
				return { status: 'skipped', invoiceRowId: raced.id };
			}
		}
		throw err;
	}
	logInfo('google-ads-dl', `Invoice ${input.invoiceId} imported`, {
		tenantId: input.tenantId,
		metadata: { source: input.source, customerId: cleanId, clientId: account.clientId, amount: parsedAmount }
	});
	return { status: 'imported', invoiceRowId: id };
}
