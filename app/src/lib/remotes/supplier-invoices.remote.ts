import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, gte, lte, like } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { searchEmails, getEmail, getAttachment } from '$lib/server/gmail/client';
import { findParser, buildSearchQuery } from '$lib/server/gmail/parsers';
import { getGmailStatus, updateLastSyncAt } from '$lib/server/gmail/auth';
import { extractInvoiceDataFromPdf } from '$lib/server/gmail/pdf-parser';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';

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

	return getGmailStatus(event.locals.tenant.id);
});

export const getSupplierListForGmail = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

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

		// Delete PDF file from disk if it exists
		if (existing.pdfPath) {
			const absolutePath = join(process.cwd(), existing.pdfPath);
			try {
				await unlink(absolutePath);
			} catch {
				console.warn(`[Supplier Invoice] Could not delete PDF: ${absolutePath}`);
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
				const absolutePath = join(process.cwd(), existing.pdfPath);
				try {
					await unlink(absolutePath);
				} catch {
					console.warn(`[Supplier Invoice] Could not delete PDF: ${absolutePath}`);
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
					} catch {
						// PDF parsing failed (encrypted/image-only) — continue with email data
					}
				}

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
					amount: parsed.amount || null,
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
	const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
	const dir = join(process.cwd(), 'uploads', 'supplier-invoices', tenantId, yearMonth);
	await mkdir(dir, { recursive: true });

	const invoiceNum = (parsed.invoiceNumber || generateId()).replace(/[^a-zA-Z0-9-_]/g, '_');
	const dateStr = date.toISOString().slice(0, 10);
	const filename = `${parsed.supplierType}_${invoiceNum}_${dateStr}.pdf`;
	const filePath = join(dir, filename);

	await writeFile(filePath, buffer);

	// Return relative path from cwd
	return join('uploads', 'supplier-invoices', tenantId, yearMonth, filename);
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
