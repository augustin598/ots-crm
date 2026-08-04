import { query, command, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, gte, lte, like } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { searchEmails, getEmail, getAttachment } from '$lib/server/gmail/client';
import { findParser, buildSearchQuery, buildInvoiceSearchQuery } from '$lib/server/gmail/parsers';
import { getGmailStatus, updateLastSyncAt } from '$lib/server/gmail/auth';
import { extractInvoiceDataFromPdf } from '$lib/server/gmail/pdf-parser';
import { getDownloadedMap } from '$lib/server/gmail/download-evidence';
import {
	parseMissingDocumentsRows,
	matchPayments,
	type InvoiceCandidate
} from '$lib/server/banking/payment-match';
import XLSX from 'xlsx';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { uploadBuffer } from '$lib/server/storage';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

// ---- Queries ----

export const getSupplierInvoices = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	const invoices = await db
		.select({
			id: table.supplierInvoice.id,
			tenantId: table.supplierInvoice.tenantId,
			supplierId: table.supplierInvoice.supplierId,
			invoiceNumber: table.supplierInvoice.invoiceNumber,
			amount: table.supplierInvoice.amount,
			currency: table.supplierInvoice.currency,
			issueDate: table.supplierInvoice.issueDate,
			dueDate: table.supplierInvoice.dueDate,
			status: table.supplierInvoice.status,
			pdfPath: table.supplierInvoice.pdfPath,
			gmailMessageId: table.supplierInvoice.gmailMessageId,
			emailSubject: table.supplierInvoice.emailSubject,
			emailFrom: table.supplierInvoice.emailFrom,
			supplierType: table.supplierInvoice.supplierType,
			importedAt: table.supplierInvoice.importedAt,
			createdAt: table.supplierInvoice.createdAt,
			supplierName: table.supplier.name,
			expenseId: table.expense.id
		})
		.from(table.supplierInvoice)
		.leftJoin(table.supplier, eq(table.supplierInvoice.supplierId, table.supplier.id))
		.leftJoin(table.expense, eq(table.expense.supplierInvoiceId, table.supplierInvoice.id))
		.where(eq(table.supplierInvoice.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.supplierInvoice.issueDate));

	return invoices;
});

export const getSupplierInvoice = query(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	const [invoice] = await db
		.select()
		.from(table.supplierInvoice)
		.where(
			and(
				eq(table.supplierInvoice.id, invoiceId),
				eq(table.supplierInvoice.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (!invoice) throw new Error('Supplier invoice not found');

	return invoice;
});

export const getGmailConnectionStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	return getGmailStatus(event.locals.tenant.id);
});

export const getSupplierListForGmail = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	const suppliers = await db
		.select({
			id: table.supplier.id,
			name: table.supplier.name,
			email: table.supplier.email
		})
		.from(table.supplier)
		.where(eq(table.supplier.tenantId, event.locals.tenant.id));

	return suppliers.filter((s) => s.email);
});

// ---- Commands ----

export const deleteSupplierInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const [existing] = await db
			.select()
			.from(table.supplierInvoice)
			.where(
				and(
					eq(table.supplierInvoice.id, invoiceId),
					eq(table.supplierInvoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) throw new Error('Supplier invoice not found');

		// Delete PDF file (try MinIO first, then filesystem fallback)
		if (existing.pdfPath) {
			try {
				const { deleteFile } = await import('$lib/server/storage');
				await deleteFile(existing.pdfPath);
			} catch {
				try {
					const absolutePath = join(process.cwd(), existing.pdfPath);
					await unlink(absolutePath);
				} catch {
					// File might not exist, that's ok
				}
			}
		}

		await db.delete(table.supplierInvoice).where(eq(table.supplierInvoice.id, invoiceId));
		return { success: true };
	}
);

export const deleteSupplierInvoices = command(
	v.object({
		invoiceIds: v.array(v.pipe(v.string(), v.minLength(1)))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const tenantId = event.locals.tenant.id;
		let deleted = 0;

		for (const invoiceId of data.invoiceIds) {
			const [existing] = await db
				.select()
				.from(table.supplierInvoice)
				.where(
					and(
						eq(table.supplierInvoice.id, invoiceId),
						eq(table.supplierInvoice.tenantId, tenantId)
					)
				)
				.limit(1);

			if (!existing) continue;

			if (existing.pdfPath) {
				try {
					const { deleteFile } = await import('$lib/server/storage');
					await deleteFile(existing.pdfPath);
				} catch {
					try {
						const absolutePath = join(process.cwd(), existing.pdfPath);
						await unlink(absolutePath);
					} catch {
						// File might not exist, that's ok
					}
				}
			}

			await db.delete(table.supplierInvoice).where(eq(table.supplierInvoice.id, invoiceId));
			deleted++;
		}

		return { deleted };
	}
);

/**
 * Preview invoices found in Gmail without importing them
 */
export const previewGmailInvoices = command(
	v.object({
		parserIds: v.optional(v.array(v.string())),
		dateFrom: v.optional(v.string()),
		dateTo: v.optional(v.string()),
		maxResults: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const tenantId = event.locals.tenant.id;
		const dateFrom = data.dateFrom ? new Date(data.dateFrom) : undefined;
		const dateTo = data.dateTo ? new Date(data.dateTo) : undefined;

		const searchQuery = buildSearchQuery(data.parserIds, dateFrom, dateTo);
		console.log(`[Gmail Import] Search query: ${searchQuery}`);

		const messages = await searchEmails(tenantId, searchQuery, data.maxResults || 50);

		// Get existing gmail message IDs to mark duplicates
		const existingInvoices = await db
			.select({ gmailMessageId: table.supplierInvoice.gmailMessageId })
			.from(table.supplierInvoice)
			.where(eq(table.supplierInvoice.tenantId, tenantId));

		const existingIds = new Set(existingInvoices.map((i) => i.gmailMessageId).filter(Boolean));

		const previews = [];
		for (const msg of messages) {
			try {
				const email = await getEmail(tenantId, msg.id);
				const parser = findParser(email.from, email.subject);

				if (!parser) continue;

				const parsed = parser.parseInvoice(email);
				const pdfAttachment = email.attachments.find(
					(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
				);

				// PDF enrichment: fill in missing fields from PDF content
				if (pdfAttachment) {
					try {
						const pdfBuffer = await getAttachment(tenantId, msg.id, pdfAttachment.id);
						const pdfData = await extractInvoiceDataFromPdf(pdfBuffer);
						if (!parsed.invoiceNumber && pdfData.invoiceNumber) parsed.invoiceNumber = pdfData.invoiceNumber;
						if (!parsed.amount && pdfData.amount) {
							parsed.amount = pdfData.amount;
							parsed.currency = pdfData.currency || parsed.currency;
						}
						if (!parsed.dueDate && pdfData.dueDate) parsed.dueDate = pdfData.dueDate;
						if (!parsed.issueDate && pdfData.issueDate) parsed.issueDate = pdfData.issueDate;
						if ((!parsed.status || parsed.status === 'pending') && pdfData.status) parsed.status = pdfData.status;
					} catch {
						// PDF parsing failed (encrypted/image-only) — continue with email data
					}
				}
				if (!parsed.currency) parsed.amount = undefined;

				previews.push({
					gmailMessageId: msg.id,
					from: email.from,
					subject: email.subject,
					date: email.date,
					parsed,
					hasPdf: !!pdfAttachment,
					alreadyImported: existingIds.has(msg.id)
				});
			} catch (err) {
				console.error(`[Gmail Import] Error processing message ${msg.id}:`, err);
			}
		}

		return { previews, totalFound: messages.length };
	}
);

/**
 * Caută în Gmail emailuri cu facturi de furnizor FĂRĂ să le importe în CRM
 * (tabul de descărcare). Implicit caută la ORICE expeditor cu PDF atașat.
 *
 * Nu întoarce niciodată attachmentId-uri Gmail (sunt efemere) — doar indexul
 * atașamentului în lista mesajului, pe care endpoint-ul de descărcare îl
 * rezolvă la un id proaspăt.
 */
export const searchGmailForDownload = command(
	v.object({
		parserIds: v.optional(v.array(v.string())),
		dateFrom: v.optional(v.string()),
		dateTo: v.optional(v.string()),
		customEmails: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
		/** 'all' (implicit) caută la ORICE expeditor cu PDF atașat, nu doar la furnizorii cunoscuți. */
		scope: v.optional(v.picklist(['all', 'suppliers'])),
		maxResults: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const searchQuery = buildInvoiceSearchQuery({
			scope: data.scope ?? 'all',
			parserIds: data.parserIds,
			customEmails: data.customEmails,
			dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
			dateTo: data.dateTo ? new Date(data.dateTo) : undefined
		});
		console.log(`[Gmail Download Search] Search query: ${searchQuery}`);

		const messages = await searchEmails(tenantId, searchQuery, data.maxResults || 150);

		const existingInvoices = await db
			.select({ gmailMessageId: table.supplierInvoice.gmailMessageId })
			.from(table.supplierInvoice)
			.where(eq(table.supplierInvoice.tenantId, tenantId));
		const importedIds = new Set(existingInvoices.map((i) => i.gmailMessageId).filter(Boolean));

		const downloadedMap = await getDownloadedMap(
			tenantId,
			messages.map((m) => m.id)
		);

		const results = [];
		for (const msg of messages) {
			try {
				const email = await getEmail(tenantId, msg.id);
				const pdfAttachments = email.attachments
					.map((a, index) => ({
						index,
						filename: a.filename,
						size: a.size,
						mimeType: a.mimeType
					}))
					.filter(
						(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
					);
				if (pdfAttachments.length === 0) continue;

				const parser = findParser(email.from, email.subject);
				const parsed = parser ? parser.parseInvoice(email) : null;

				results.push({
					gmailMessageId: msg.id,
					from: email.from,
					subject: email.subject,
					date: email.date,
					pdfAttachments,
					// Nicio sumă fără valută — dacă parserul n-a putut determina valuta, nu o raportăm
					amount: parsed?.currency ? (parsed.amount ?? null) : null,
					currency: parsed?.currency ?? null,
					supplierType: parsed?.supplierType ?? null,
					alreadyImported: importedIds.has(msg.id),
					downloadedAt: downloadedMap.get(msg.id) ?? null
				});
			} catch (err) {
				console.error(`[Gmail Download Search] Error on message ${msg.id}:`, err);
			}
		}

		return { results, totalFound: messages.length };
	}
);

/**
 * Primește XLSX-ul „Documente Lipsa" exportat din Keez (plăți fără document)
 * și potrivește fiecare plată cu emailurile de factură găsite în Gmail.
 */
export const matchMissingDocuments = command(
	v.object({ fileBase64: v.pipe(v.string(), v.minLength(8)) }),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const base64Data = data.fileBase64.replace(/^data:.*;base64,/, '');
		const workbook = XLSX.read(Buffer.from(base64Data, 'base64'), { type: 'buffer' });
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
		const { payments, ignoredIncomes } = parseMissingDocumentsRows(rawRows);
		if (payments.length === 0) {
			return { payments: [], ignoredIncomes, candidatesFound: 0 };
		}

		// Fereastra de căutare: min/max data plăților, cu padding de 10 zile
		const times = payments.map((p) => p.date.getTime());
		const dateFrom = new Date(Math.min(...times) - 10 * 86_400_000);
		const dateTo = new Date(Math.max(...times) + 10 * 86_400_000);

		// Căutăm la ORICE expeditor cu PDF atașat, nu doar la furnizorii cu parser —
		// altfel plățile către furnizori necunoscuți (Kesselring, fidasolutions etc.)
		// n-ar găsi niciodată factura.
		const searchQuery = buildInvoiceSearchQuery({ scope: 'all', dateFrom, dateTo });
		console.log(`[Missing Docs Match] Search query: ${searchQuery}`);

		const messages = await searchEmails(tenantId, searchQuery, 200);

		const downloadedMap = await getDownloadedMap(
			tenantId,
			messages.map((m) => m.id)
		);
		const candidates: InvoiceCandidate[] = [];
		const candidateMeta = new Map<
			string,
			{ pdfAttachments: Array<{ index: number; filename: string }>; downloadedAt: Date | null }
		>();

		for (const msg of messages) {
			try {
				const email = await getEmail(tenantId, msg.id);
				const pdfAttachments = email.attachments
					.map((a, index) => ({ index, filename: a.filename, mimeType: a.mimeType }))
					.filter(
						(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
					)
					.map(({ index, filename }) => ({ index, filename }));
				if (pdfAttachments.length === 0) continue;

				const parser = findParser(email.from, email.subject);
				const parsed = parser ? parser.parseInvoice(email) : null;
				// Nicio sumă fără valută — altfel am compara mere cu pere la scor
				let amount = parsed?.currency ? parsed.amount : undefined;
				let currency = parsed?.currency;

				// Îmbogățire din PDF doar când emailul n-a dat suma — un singur fetch în plus per email
				if (amount == null) {
					const pdfAtt = email.attachments.find(
						(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
					);
					if (pdfAtt) {
						try {
							const pdfBuffer = await getAttachment(tenantId, msg.id, pdfAtt.id);
							const pdfData = await extractInvoiceDataFromPdf(pdfBuffer);
							if (pdfData.amount && pdfData.currency) {
								amount = pdfData.amount;
								currency = pdfData.currency;
							}
						} catch {
							// PDF criptat/imagine — mergem mai departe fără sumă
						}
					}
				}

				candidates.push({
					gmailMessageId: msg.id,
					from: email.from,
					subject: email.subject,
					date: email.date,
					amount: amount ?? undefined,
					currency: currency ?? undefined,
					supplierType: parsed?.supplierType
				});
				candidateMeta.set(msg.id, {
					pdfAttachments,
					downloadedAt: downloadedMap.get(msg.id) ?? null
				});
			} catch (err) {
				console.error(`[Missing Docs Match] Error on message ${msg.id}:`, err);
			}
		}

		const matched = matchPayments(payments, candidates);
		return {
			payments: matched.map((m) => ({
				...m,
				matchMeta: m.match ? (candidateMeta.get(m.match.gmailMessageId) ?? null) : null
			})),
			ignoredIncomes,
			candidatesFound: candidates.length
		};
	}
);

/**
 * Import selected invoices from Gmail
 */
export const importSelectedInvoices = command(
	v.object({
		messageIds: v.array(v.pipe(v.string(), v.minLength(1)))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const tenantId = event.locals.tenant.id;
		const results = {
			imported: 0,
			skippedDuplicates: 0,
			errors: [] as string[]
		};

		for (const messageId of data.messageIds) {
			try {
				// Check for duplicate
				const [existing] = await db
					.select()
					.from(table.supplierInvoice)
					.where(
						and(
							eq(table.supplierInvoice.gmailMessageId, messageId),
							eq(table.supplierInvoice.tenantId, tenantId)
						)
					)
					.limit(1);

				if (existing) {
					results.skippedDuplicates++;
					continue;
				}

				const email = await getEmail(tenantId, messageId);
				const parser = findParser(email.from, email.subject);

				if (!parser) {
					results.errors.push(`No parser found for: ${email.subject}`);
					continue;
				}

				const parsed = parser.parseInvoice(email);

				// Download PDF attachment if available
				let pdfPath: string | null = null;
				const pdfAttachment = email.attachments.find(
					(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
				);

				if (pdfAttachment) {
					const pdfBuffer = await getAttachment(tenantId, messageId, pdfAttachment.id);

					// PDF enrichment: fill in missing fields from PDF content
					try {
						const pdfData = await extractInvoiceDataFromPdf(pdfBuffer);
						if (!parsed.invoiceNumber && pdfData.invoiceNumber) parsed.invoiceNumber = pdfData.invoiceNumber;
						if (!parsed.amount && pdfData.amount) {
							parsed.amount = pdfData.amount;
							parsed.currency = pdfData.currency || parsed.currency;
						}
						if (!parsed.dueDate && pdfData.dueDate) parsed.dueDate = pdfData.dueDate;
						if (!parsed.issueDate && pdfData.issueDate) parsed.issueDate = pdfData.issueDate;
						if ((!parsed.status || parsed.status === 'pending') && pdfData.status) parsed.status = pdfData.status;
					} catch {
						// PDF parsing failed — continue with email data
					}

					pdfPath = await savePdf(tenantId, pdfBuffer, parsed, email.date);
				}

				// Auto-link to existing supplier or create new one
				const supplierId = await findOrCreateSupplier(
					tenantId,
					email.from,
					parsed.supplierName
				);

				// Create supplier invoice record
				await db.insert(table.supplierInvoice).values({
					id: generateId(),
					tenantId,
					supplierId,
					invoiceNumber: parsed.invoiceNumber || null,
					amount: parsed.currency ? parsed.amount || null : null,
					currency: parsed.currency || 'USD',
					issueDate: parsed.issueDate || email.date,
					dueDate: parsed.dueDate || null,
					status: parsed.status || 'pending',
					pdfPath,
					gmailMessageId: messageId,
					emailSubject: email.subject,
					emailFrom: email.from,
					supplierType: parsed.supplierType,
					rawEmailData: JSON.stringify({
						from: email.from,
						subject: email.subject,
						date: email.date,
						attachments: email.attachments.map((a) => a.filename)
					}),
					importedAt: new Date(),
					createdAt: new Date(),
					updatedAt: new Date()
				});

				results.imported++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				results.errors.push(`Message ${messageId}: ${msg}`);
			}
		}

		// Update last sync timestamp
		await updateLastSyncAt(tenantId);

		return results;
	}
);

/**
 * Update Gmail sync configuration for the current tenant
 */
export const updateGmailSyncConfig = command(
	v.object({
		syncEnabled: v.boolean(),
		syncInterval: v.picklist(['daily', 'twice_daily', 'weekly']),
		syncParserIds: v.optional(v.nullable(v.array(v.string()))),
		syncDateRangeDays: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(90))),
		customMonitoredEmails: v.optional(
			v.nullable(
				v.array(
					v.object({
						label: v.string(),
						value: v.pipe(v.string(), v.minLength(1))
					})
				)
			)
		),
		monitoredSupplierIds: v.optional(v.nullable(v.array(v.string()))),
		excludeEmails: v.optional(v.nullable(v.array(v.pipe(v.string(), v.minLength(1)))))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const tenantId = event.locals.tenant.id;

		const [integration] = await db
			.select()
			.from(table.gmailIntegration)
			.where(eq(table.gmailIntegration.tenantId, tenantId))
			.limit(1);

		if (!integration) {
			throw new Error('Gmail not connected');
		}

		await db
			.update(table.gmailIntegration)
			.set({
				syncEnabled: data.syncEnabled,
				syncInterval: data.syncInterval,
				syncParserIds: data.syncParserIds ? JSON.stringify(data.syncParserIds) : null,
				syncDateRangeDays: data.syncDateRangeDays ?? 7,
				customMonitoredEmails: data.customMonitoredEmails ? JSON.stringify(data.customMonitoredEmails) : null,
				monitoredSupplierIds: data.monitoredSupplierIds ? JSON.stringify(data.monitoredSupplierIds) : null,
				excludeEmails: data.excludeEmails ? JSON.stringify(data.excludeEmails) : null,
				updatedAt: new Date()
			})
			.where(eq(table.gmailIntegration.id, integration.id));

		return { success: true };
	}
);

/**
 * Get last sync results for the current tenant
 */
export const getLastSyncResults = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	const [integration] = await db
		.select({
			lastSyncResults: table.gmailIntegration.lastSyncResults,
			lastSyncAt: table.gmailIntegration.lastSyncAt
		})
		.from(table.gmailIntegration)
		.where(eq(table.gmailIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!integration?.lastSyncResults) return null;

	return JSON.parse(integration.lastSyncResults);
});

/**
 * Create an expense from a supplier invoice (auto-populate fields)
 */
export const createExpenseFromSupplierInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (supplierInvoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const tenantId = event.locals.tenant.id;

		// Fetch supplier invoice
		const [invoice] = await db
			.select()
			.from(table.supplierInvoice)
			.where(
				and(
					eq(table.supplierInvoice.id, supplierInvoiceId),
					eq(table.supplierInvoice.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!invoice) throw new Error('Factura furnizor nu a fost găsită');

		// Check if already linked
		const [existingExpense] = await db
			.select()
			.from(table.expense)
			.where(eq(table.expense.supplierInvoiceId, supplierInvoiceId))
			.limit(1);

		if (existingExpense) throw new Error('Această factură are deja o cheltuială asociată');

		// Create expense
		const expenseId = generateId();
		await db.insert(table.expense).values({
			id: expenseId,
			tenantId,
			supplierId: invoice.supplierId,
			description: invoice.emailSubject || `Factură ${invoice.invoiceNumber || 'furnizor'}`,
			amount: invoice.amount || 0,
			currency: invoice.currency || 'USD',
			date: invoice.issueDate || new Date(),
			invoicePath: invoice.pdfPath,
			isPaid: invoice.status === 'paid',
			supplierInvoiceId,
			createdByUserId: event.locals.user.id,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		return { expenseId };
	}
);

/**
 * Link an existing expense to a supplier invoice
 */
export const linkSupplierInvoiceToExpense = command(
	v.object({
		supplierInvoiceId: v.pipe(v.string(), v.minLength(1)),
		expenseId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		await requireStaff(event);

		const tenantId = event.locals.tenant.id;

		// Validate both belong to tenant
		const [invoice] = await db
			.select()
			.from(table.supplierInvoice)
			.where(
				and(
					eq(table.supplierInvoice.id, data.supplierInvoiceId),
					eq(table.supplierInvoice.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!invoice) throw new Error('Factura furnizor nu a fost găsită');

		const [expense] = await db
			.select()
			.from(table.expense)
			.where(
				and(
					eq(table.expense.id, data.expenseId),
					eq(table.expense.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!expense) throw new Error('Cheltuiala nu a fost găsită');

		await db
			.update(table.expense)
			.set({ supplierInvoiceId: data.supplierInvoiceId, updatedAt: new Date() })
			.where(eq(table.expense.id, data.expenseId));

		return { success: true };
	}
);

// ---- Helpers ----

async function savePdf(
	tenantId: string,
	buffer: Buffer,
	parsed: { supplierType: string; invoiceNumber?: string },
	date: Date
): Promise<string> {
	const invoiceNum = (parsed.invoiceNumber || generateId()).replace(/[^a-zA-Z0-9-_]/g, '_');
	const dateStr = date.toISOString().slice(0, 10);
	const filename = `${parsed.supplierType}_${invoiceNum}_${dateStr}.pdf`;

	const upload = await uploadBuffer(
		tenantId,
		buffer,
		filename,
		'application/pdf',
		{ type: 'supplier-invoice', supplierType: parsed.supplierType }
	);

	return upload.path;
}

async function findOrCreateSupplier(
	tenantId: string,
	emailFrom: string,
	supplierName: string
): Promise<string> {
	// Extract email address from "Name <email>" format
	const emailMatch = emailFrom.match(/<(.+?)>/);
	const emailAddress = emailMatch ? emailMatch[1] : emailFrom;
	const domain = emailAddress.split('@')[1] || '';

	// Try to find existing supplier by email domain match
	const suppliers = await db
		.select()
		.from(table.supplier)
		.where(eq(table.supplier.tenantId, tenantId));

	for (const supplier of suppliers) {
		if (supplier.email && supplier.email.toLowerCase().includes(domain.toLowerCase())) {
			return supplier.id;
		}
		if (supplier.name.toLowerCase() === supplierName.toLowerCase()) {
			return supplier.id;
		}
	}

	// Create new supplier
	const supplierId = generateId();
	await db.insert(table.supplier).values({
		id: supplierId,
		tenantId,
		name: supplierName,
		email: emailAddress,
		createdAt: new Date(),
		updatedAt: new Date()
	});

	return supplierId;
}
