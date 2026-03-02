import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { searchEmails, getEmail, getAttachment } from '../../gmail/client';
import { findParser, buildSearchQuery } from '../../gmail/parsers';
import { updateLastSyncAt } from '../../gmail/auth';
import { extractInvoiceDataFromPdf } from '../../gmail/pdf-parser';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Process Gmail invoice sync for all active Gmail integrations
 */
export async function processGmailInvoiceSync(params: Record<string, any> = {}) {
	try {
		const integrations = await db
			.select()
			.from(table.gmailIntegration)
			.where(eq(table.gmailIntegration.isActive, true));

		if (integrations.length === 0) {
			console.log('[Gmail-Sync] No active Gmail integrations found. Skipping.');
			return { success: true, tenantsProcessed: 0, totalImported: 0 };
		}

		let tenantsProcessed = 0;
		let totalImported = 0;
		const errors: Array<{ tenantId: string; error: string }> = [];

		const timeSlot = params.timeSlot as string | undefined;

		for (const integration of integrations) {
			try {
				// Skip tenants with sync disabled
				if (!integration.syncEnabled) {
					console.log(`[Gmail-Sync] Sync disabled for tenant ${integration.tenantId}. Skipping.`);
					continue;
				}

				// Respect sync interval: twice_daily runs both morning & evening, weekly only on Monday morning
				if (timeSlot === 'evening' && integration.syncInterval !== 'twice_daily') {
					continue;
				}
				if (integration.syncInterval === 'weekly') {
					const now = new Date();
					if (now.getDay() !== 1 /* Monday */) continue;
				}

				console.log(`[Gmail-Sync] Processing tenant ${integration.tenantId}...`);

				// Use tenant-specific date range
				const daysBack = integration.syncDateRangeDays || 7;
				const dateFrom = integration.lastSyncAt || new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

				// Use tenant-specific parser selection
				const parserIds = integration.syncParserIds ? JSON.parse(integration.syncParserIds) : undefined;
				const query = buildSearchQuery(parserIds, dateFrom);

				const messages = await searchEmails(integration.tenantId, query, 100);

				let imported = 0;
				for (const msg of messages) {
					try {
						// Check for duplicate
						const [existing] = await db
							.select()
							.from(table.supplierInvoice)
							.where(
								and(
									eq(table.supplierInvoice.gmailMessageId, msg.id),
									eq(table.supplierInvoice.tenantId, integration.tenantId)
								)
							)
							.limit(1);

						if (existing) continue;

						const email = await getEmail(integration.tenantId, msg.id);
						const parser = findParser(email.from, email.subject);
						if (!parser) continue;

						const parsed = parser.parseInvoice(email);

						// Download PDF
						let pdfPath: string | null = null;
						const pdfAttachment = email.attachments.find(
							(a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
						);

						if (pdfAttachment) {
							const pdfBuffer = await getAttachment(integration.tenantId, msg.id, pdfAttachment.id);

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

							pdfPath = await savePdf(integration.tenantId, pdfBuffer, parsed, email.date);
						}

						// Auto-link supplier
						const supplierId = await findOrCreateSupplier(
							integration.tenantId,
							email.from,
							parsed.supplierName
						);

						await db.insert(table.supplierInvoice).values({
							id: generateId(),
							tenantId: integration.tenantId,
							supplierId,
							invoiceNumber: parsed.invoiceNumber || null,
							amount: parsed.amount || null,
							currency: parsed.currency || 'USD',
							issueDate: parsed.issueDate || email.date,
							dueDate: parsed.dueDate || null,
							status: parsed.status || 'pending',
							pdfPath,
							gmailMessageId: msg.id,
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

						imported++;
					} catch (err) {
						console.error(`[Gmail-Sync] Error processing message ${msg.id}:`, err);
					}
				}

				// Save sync results and update lastSyncAt
				const syncResults = JSON.stringify({
					imported,
					errors: 0,
					timestamp: new Date().toISOString()
				});
				await db
					.update(table.gmailIntegration)
					.set({
						lastSyncAt: new Date(),
						lastSyncResults: syncResults,
						updatedAt: new Date()
					})
					.where(eq(table.gmailIntegration.id, integration.id));

				tenantsProcessed++;
				totalImported += imported;

				console.log(`[Gmail-Sync] Tenant ${integration.tenantId}: imported ${imported} invoices`);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				errors.push({ tenantId: integration.tenantId, error: message });
				console.error(`[Gmail-Sync] Error for tenant ${integration.tenantId}:`, err);

				// Save error results
				try {
					const syncResults = JSON.stringify({
						imported: 0,
						errors: 1,
						errorDetails: [message],
						timestamp: new Date().toISOString()
					});
					await db
						.update(table.gmailIntegration)
						.set({ lastSyncResults: syncResults, updatedAt: new Date() })
						.where(eq(table.gmailIntegration.id, integration.id));
				} catch {
					// Ignore secondary errors
				}
			}
		}

		return { success: true, tenantsProcessed, totalImported, errors };
	} catch (err) {
		console.error('[Gmail-Sync] Fatal error:', err);
		throw err;
	}
}

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

	return join('uploads', 'supplier-invoices', tenantId, yearMonth, filename);
}

async function findOrCreateSupplier(
	tenantId: string,
	emailFrom: string,
	supplierName: string
): Promise<string> {
	const emailMatch = emailFrom.match(/<(.+?)>/);
	const emailAddress = emailMatch ? emailMatch[1] : emailFrom;
	const domain = emailAddress.split('@')[1] || '';

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
