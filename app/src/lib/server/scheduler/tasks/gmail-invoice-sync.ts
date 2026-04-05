import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, or } from 'drizzle-orm';
import { searchEmails, getEmail, getAttachment } from '../../gmail/client';
import { findParserWithFallback, buildSearchQuery, shouldExcludeEmail, isFromCustomSource } from '../../gmail/parsers';
import { updateLastSyncAt, getAuthenticatedClient } from '../../gmail/auth';
import { extractInvoiceDataFromPdf } from '../../gmail/pdf-parser';
import { uploadBuffer } from '$lib/server/storage';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { createNotification } from '$lib/server/notifications';

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
			logInfo('scheduler', 'Gmail invoice sync: no active integrations found, skipping', { metadata: { activeIntegrations: 0 } });
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
					logInfo('scheduler', `Gmail invoice sync: sync disabled for tenant, skipping`, { tenantId: integration.tenantId });
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

				logInfo('scheduler', `Gmail invoice sync: processing tenant`, { tenantId: integration.tenantId });

				// Use tenant-specific date range
				const daysBack = integration.syncDateRangeDays || 7;
				const dateFrom = integration.lastSyncAt || new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

				// Use tenant-specific parser selection
				const parserIds = integration.syncParserIds ? JSON.parse(integration.syncParserIds) : undefined;

				// Load custom monitored emails
				const customEmails: string[] = [];
				if (integration.customMonitoredEmails) {
					const parsed: Array<{ label: string; value: string }> = JSON.parse(integration.customMonitoredEmails);
					customEmails.push(...parsed.map((e) => e.value));
				}
				if (integration.monitoredSupplierIds) {
					const supplierIds: string[] = JSON.parse(integration.monitoredSupplierIds);
					if (supplierIds.length > 0) {
						const suppliers = await db
							.select({ id: table.supplier.id, email: table.supplier.email })
							.from(table.supplier)
							.where(eq(table.supplier.tenantId, integration.tenantId));
						for (const s of suppliers) {
							if (s.email && supplierIds.includes(s.id)) {
								customEmails.push(s.email);
							}
						}
					}
				}

				// Load exclusion patterns
				const excludePatterns: string[] = integration.excludeEmails
					? JSON.parse(integration.excludeEmails)
					: [];

				const query = buildSearchQuery(parserIds, dateFrom, undefined, customEmails.length > 0 ? customEmails : undefined);

				// Pre-check: verify OAuth token is still valid before searching
				const authClient = await getAuthenticatedClient(integration.tenantId);
				if (!authClient) {
					logWarning('scheduler', 'Gmail invoice sync: OAuth token invalid/revoked — notifying admins', { tenantId: integration.tenantId });

					// Notify tenant admins
					const admins = await db
						.select({ userId: table.tenantUser.userId })
						.from(table.tenantUser)
						.where(
							and(
								eq(table.tenantUser.tenantId, integration.tenantId),
								or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
							)
						);

					for (const admin of admins) {
						await createNotification({
							tenantId: integration.tenantId,
							userId: admin.userId,
							type: 'sync.error',
							title: 'Sesiune Gmail expirată',
							message: `Sesiunea Gmail (${integration.email}) a expirat. Deschide pagina Facturi Furnizori → Gmail și reconectează contul.`,
							link: '/facturi-furnizori?tab=gmail'
						});
					}

					errors.push({ tenantId: integration.tenantId, error: 'Gmail OAuth token expired/revoked' });
					continue;
				}

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

						// Apply exclusion filter
						if (shouldExcludeEmail(email.from, excludePatterns)) continue;

						const customMonitored = isFromCustomSource(email.from, customEmails);
						const parser = findParserWithFallback(email.from, email.subject, customMonitored);
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
						const { message, stack } = serializeError(err);
						logError('scheduler', `Gmail invoice sync: error processing message ${msg.id}: ${message}`, { tenantId: integration.tenantId, stackTrace: stack });
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

				logInfo('scheduler', `Gmail invoice sync: tenant completed`, { tenantId: integration.tenantId, metadata: { imported } });
			} catch (err) {
				const { message, stack } = serializeError(err);
				errors.push({ tenantId: integration.tenantId, error: message });
				logError('scheduler', `Gmail invoice sync: error for tenant: ${message}`, { tenantId: integration.tenantId, stackTrace: stack });

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
		const { message, stack } = serializeError(err);
		logError('scheduler', `Gmail invoice sync: fatal error: ${message}`, { stackTrace: stack });
		throw err;
	}
}

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
