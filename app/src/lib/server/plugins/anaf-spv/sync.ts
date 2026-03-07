/**
 * Internal SPV invoice sync function for scheduled tasks
 * This function can be called without request event context
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, like, sql } from 'drizzle-orm';
import { AnafSpvClient } from './client';
import { decrypt } from './crypto';
import { parseUblInvoice } from './xml-parser';
import { mapUblInvoiceToExpense, mapAnafCompanyToSupplier, mapUblInvoiceToCrm, mapAnafCompanyToClient, normalizeVatId, normalizeInvoiceNumber } from './mapper';
import { uploadBuffer } from '$lib/server/storage';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateSupplierId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateExpenseId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Sync SPV invoices for a tenant (internal function for scheduled tasks)
 * @param tenantId - Tenant ID
 * @param filter - "P" for suppliers (received), "T" for sent
 * @param days - Number of days to look back
 */
export async function syncSpvInvoicesForTenant(
	tenantId: string,
	filter: 'P' | 'T' = 'P',
	days: number = 2
): Promise<{
	success: boolean;
	imported: number;
	updated: number;
	skipped: number;
	errors: number;
}> {
	try {
		// Get integration
		const [integration] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(
				and(
					eq(table.anafSpvIntegration.tenantId, tenantId),
					eq(table.anafSpvIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('ANAF SPV integration not connected or not active');
		}

		// Get tenant
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required');
		}

		// Get a tenant owner/admin user for createdByUserId (required field)
		const [tenantUser] = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.tenantId, tenantId),
					or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
				)
			)
			.limit(1);

		if (!tenantUser) {
			throw new Error('No owner or admin user found for tenant');
		}

		const systemUserId = tenantUser.userId;

		// Decrypt tokens and credentials
		if (!integration.accessToken || !integration.refreshToken) {
			throw new Error('ANAF SPV integration tokens not found');
		}

		const accessToken = decrypt(tenantId, integration.accessToken);
		const refreshToken = decrypt(tenantId, integration.refreshToken);
		const clientId = integration.clientId ? decrypt(tenantId, integration.clientId) : undefined;
		const clientSecret = integration.clientSecret
			? decrypt(tenantId, integration.clientSecret)
			: undefined;

		// Create SPV client
		const spvClient = new AnafSpvClient({
			accessToken,
			refreshToken,
			expiresAt: integration.expiresAt || undefined,
			clientId,
			clientSecret
		});

		// Get invoices from SPV
		const spvInvoices = await spvClient.getInvoicesFromSpv(tenant.cui, filter, days);

		// Get already synced invoice IDs
		const syncedInvoices = await db
			.select({ spvId: table.anafSpvInvoiceSync.spvId })
			.from(table.anafSpvInvoiceSync)
			.where(
				and(
					eq(table.anafSpvInvoiceSync.tenantId, tenantId),
					eq(table.anafSpvInvoiceSync.syncDirection, 'pull')
				)
			);

		const syncedSpvIds = new Set(syncedInvoices.map((s) => s.spvId));

		let imported = 0;
		let updated = 0;
		let skipped = 0;
		let errors = 0;

		// Process each invoice
		for (const spvInvoice of spvInvoices) {
			try {
				// Skip if already synced
				if (syncedSpvIds.has(spvInvoice.id)) {
					skipped++;
					continue;
				}

				// Download invoice XML
				const { xml, zipBuffer } = await spvClient.getInvoiceFromSpv(spvInvoice.id);

				// Parse UBL XML
				const ublData = parseUblInvoice(xml);

				// Check if expense already exists by description containing invoice number
				// (Expenses from other providers might have similar descriptions)
				const [existingExpense] = await db
					.select()
					.from(table.expense)
					.where(
						and(
							eq(table.expense.tenantId, tenantId),
							like(table.expense.description, `%${ublData.invoiceNumber}%`)
						)
					)
					.limit(1);

				// Normalize VAT ID for comparison
				const supplierVatId = normalizeVatId(ublData.supplier.vatId);

				// Find or create supplier, and update with latest data from invoice
				let supplierId: string;

				if (existingExpense && existingExpense.supplierId) {
					supplierId = existingExpense.supplierId;

					// Update existing supplier with fresh data from invoice
					await db
						.update(table.supplier)
						.set({
							name: ublData.supplier.name,
							vatNumber: ublData.supplier.taxId || ublData.supplier.vatId,
							address: ublData.supplier.address || undefined,
							city: ublData.supplier.city || undefined,
							county: ublData.supplier.county || undefined,
							postalCode: ublData.supplier.postalCode || undefined,
							country: ublData.supplier.country || 'România',
							email: ublData.supplier.email || undefined,
							iban: ublData.supplier.iban || undefined,
							bankName: ublData.supplier.bankName || undefined,
							updatedAt: new Date()
						})
						.where(eq(table.supplier.id, supplierId));
				} else {
					// Try to find existing supplier by CUI or VAT code
					const [existingSupplier] = await db
						.select()
						.from(table.supplier)
						.where(and(eq(table.supplier.tenantId, tenantId), eq(table.supplier.cui, supplierVatId)))
						.limit(1);

					if (existingSupplier) {
						supplierId = existingSupplier.id;

						// Update existing supplier with fresh data from invoice
						await db
							.update(table.supplier)
							.set({
								name: ublData.supplier.name,
								vatNumber: ublData.supplier.taxId || ublData.supplier.vatId,
								address: ublData.supplier.address || undefined,
								city: ublData.supplier.city || undefined,
								county: ublData.supplier.county || undefined,
								postalCode: ublData.supplier.postalCode || undefined,
								country: ublData.supplier.country || 'România',
								email: ublData.supplier.email || undefined,
								iban: ublData.supplier.iban || undefined,
								bankName: ublData.supplier.bankName || undefined,
								updatedAt: new Date()
							})
							.where(eq(table.supplier.id, supplierId));
					} else {
						// Get company data from ANAF
						const companyData = await spvClient.getCompanyFromAnaf(ublData.supplier.vatId);

						if (!companyData) {
							// Create supplier with minimal data from invoice
							const newSupplierId = generateSupplierId();
							await db.insert(table.supplier).values({
								id: newSupplierId,
								tenantId: tenantId,
								name: ublData.supplier.name,
								cui: supplierVatId,
								vatNumber: ublData.supplier.taxId || ublData.supplier.vatId,
								address: ublData.supplier.address,
								city: ublData.supplier.city,
								county: ublData.supplier.county,
								postalCode: ublData.supplier.postalCode,
								country: ublData.supplier.country || 'România',
								email: ublData.supplier.email,
								iban: ublData.supplier.iban,
								bankName: ublData.supplier.bankName
							});
							supplierId = newSupplierId;
						} else {
							// Create supplier from ANAF data with bank info
							const supplierData = mapAnafCompanyToSupplier(companyData, tenantId, {
								iban: ublData.supplier.iban,
								bankName: ublData.supplier.bankName
							});
							const newSupplierId = generateSupplierId();
							await db.insert(table.supplier).values({
								id: newSupplierId,
								...supplierData
							});
							supplierId = newSupplierId;
						}
					}
				}

				// Map UBL invoice to expense format
				const expenseData = mapUblInvoiceToExpense(ublData, tenantId, systemUserId, supplierId);

				let expenseId: string;

				if (existingExpense) {
					// Update existing expense with SPV data
					expenseId = existingExpense.id;
					await db
						.update(table.expense)
						.set({
							supplierId: supplierId,
							description: expenseData.description,
							amount: expenseData.amount,
							currency: expenseData.currency,
							date: expenseData.date,
							vatRate: expenseData.vatRate,
							vatAmount: expenseData.vatAmount,
							updatedAt: new Date()
						})
						.where(eq(table.expense.id, existingExpense.id));

					updated++;
				} else {
					// Create new expense
					expenseId = generateExpenseId();
					await db.insert(table.expense).values({
						id: expenseId,
						...expenseData
					});

					imported++;
				}

				// Upload XML file to MinIO
				const xmlBuffer = Buffer.from(xml, 'utf-8');
				const xmlUpload = await uploadBuffer(
					tenantId,
					xmlBuffer,
					`factura-${ublData.invoiceNumber}-${spvInvoice.id}.xml`,
					'application/xml',
					{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
				);

				// Convert UBL to PDF and upload
				let pdfPath: string | null = null;
				try {
					const pdfBuffer = await spvClient.ublToPdf(xml, `Invoice ${ublData.invoiceNumber}`);
					if (pdfBuffer) {
						const pdfUpload = await uploadBuffer(
							tenantId,
							pdfBuffer,
							`factura-${ublData.invoiceNumber}-${spvInvoice.id}.pdf`,
							'application/pdf',
							{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
						);
						pdfPath = pdfUpload.path;

						// Update expense with PDF path
						await db
							.update(table.expense)
							.set({
								invoicePath: pdfPath,
								updatedAt: new Date()
							})
							.where(eq(table.expense.id, expenseId));
					}
				} catch (pdfError) {
					const err = serializeError(pdfError);
					logError('anaf-spv', `Failed to convert UBL to PDF for invoice ${spvInvoice.id}: ${err.message}`, { tenantId, stackTrace: err.stack });
					// Continue even if PDF conversion fails
				}

				// Create or update sync record for expense
				const [existingSync] = await db
					.select()
					.from(table.anafSpvInvoiceSync)
					.where(
						and(
							eq(table.anafSpvInvoiceSync.expenseId, expenseId),
							eq(table.anafSpvInvoiceSync.syncDirection, 'pull')
						)
					)
					.limit(1);

				if (existingSync) {
					// Update existing sync record
					await db
						.update(table.anafSpvInvoiceSync)
						.set({
							spvId: spvInvoice.id,
							lastSyncedAt: new Date(),
							syncStatus: 'synced',
							updatedAt: new Date()
						})
						.where(eq(table.anafSpvInvoiceSync.id, existingSync.id));
				} else {
					// Create new sync record
					const syncId = generateSyncId();
					await db.insert(table.anafSpvInvoiceSync).values({
						id: syncId,
						expenseId: expenseId, // Store expenseId for pull operations
						invoiceId: null, // Only set for push operations
						tenantId: tenantId,
						spvId: spvInvoice.id,
						syncDirection: 'pull',
						lastSyncedAt: new Date(),
						syncStatus: 'synced'
					});
				}
			} catch (error) {
				const err = serializeError(error);
				logError('anaf-spv', `Failed to sync invoice ${spvInvoice.id}: ${err.message}`, { tenantId, stackTrace: err.stack });
				errors++;

				// Create error sync record
				try {
					const syncId = generateSyncId();
					await db.insert(table.anafSpvInvoiceSync).values({
						id: syncId,
						invoiceId: null, // No invoice created - nullable for error records
						tenantId: tenantId,
						spvId: spvInvoice.id,
						syncDirection: 'pull',
						syncStatus: 'error',
						errorMessage: error instanceof Error ? error.message : String(error)
					});
				} catch (syncError) {
					const err2 = serializeError(syncError);
					logError('anaf-spv', `Failed to create error sync record: ${err2.message}`, { tenantId, stackTrace: err2.stack });
				}
			}
		}

		// Update integration last sync time
		await db
			.update(table.anafSpvIntegration)
			.set({
				lastSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.anafSpvIntegration.id, integration.id));

		return {
			success: true,
			imported,
			updated,
			skipped,
			errors
		};
	} catch (error) {
		const err = serializeError(error);
		logError('anaf-spv', `Failed to sync invoices for tenant ${tenantId}: ${err.message}`, { tenantId, stackTrace: err.stack });
		throw error;
	}
}

/**
 * Sync sent invoices from SPV for a tenant (invoices you created and sent to clients)
 * @param tenantId - Tenant ID
 * @param days - Number of days to look back
 */
export async function syncSentInvoicesFromSpv(
	tenantId: string,
	days: number = 2
): Promise<{
	success: boolean;
	imported: number;
	updated: number;
	skipped: number;
	errors: number;
}> {
	try {
		// Get integration
		const [integration] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(
				and(
					eq(table.anafSpvIntegration.tenantId, tenantId),
					eq(table.anafSpvIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('ANAF SPV integration not connected or not active');
		}

		// Get tenant
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required');
		}

		// Get a tenant owner/admin user for createdByUserId (required field)
		const [tenantUser] = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.tenantId, tenantId),
					or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
				)
			)
			.limit(1);

		if (!tenantUser) {
			throw new Error('No owner or admin user found for tenant');
		}

		const systemUserId = tenantUser.userId;

		// Decrypt tokens and credentials
		if (!integration.accessToken || !integration.refreshToken) {
			throw new Error('ANAF SPV integration tokens not found');
		}

		const accessToken = decrypt(tenantId, integration.accessToken);
		const refreshToken = decrypt(tenantId, integration.refreshToken);
		const clientId = integration.clientId ? decrypt(tenantId, integration.clientId) : undefined;
		const clientSecret = integration.clientSecret
			? decrypt(tenantId, integration.clientSecret)
			: undefined;

		// Create SPV client
		const spvClient = new AnafSpvClient({
			accessToken,
			refreshToken,
			expiresAt: integration.expiresAt || undefined,
			clientId,
			clientSecret
		});

		// Get sent invoices from SPV (filter = 'T' for transmitted/sent)
		const spvInvoices = await spvClient.getInvoicesFromSpv(tenant.cui, 'T', days);

		// Get already synced invoice IDs for sent invoices
		const syncedInvoices = await db
			.select({ spvId: table.anafSpvInvoiceSync.spvId })
			.from(table.anafSpvInvoiceSync)
			.where(
				and(
					eq(table.anafSpvInvoiceSync.tenantId, tenantId),
					eq(table.anafSpvInvoiceSync.syncDirection, 'pull-sent')
				)
			);

		const syncedSpvIds = new Set(syncedInvoices.map((s) => s.spvId));

		let imported = 0;
		let updated = 0;
		let skipped = 0;
		let errors = 0;

		// Process each invoice
		for (const spvInvoice of spvInvoices) {
			try {
				// Skip if already synced
				if (syncedSpvIds.has(spvInvoice.id)) {
					skipped++;
					continue;
				}

				// Download invoice XML
				const { xml, zipBuffer } = await spvClient.getInvoiceFromSpv(spvInvoice.id);

				// Parse UBL XML
				const ublData = parseUblInvoice(xml);

				// Check if invoice already exists by invoice number (may have been synced from another provider)
				// Normalize invoice numbers for comparison (handle NTS00144 vs NTS-00144)
				const normalizedInvoiceNumber = normalizeInvoiceNumber(ublData.invoiceNumber);

				// Get all invoices with similar numbers and filter by normalized comparison
				const potentialInvoices = await db
					.select()
					.from(table.invoice)
					.where(eq(table.invoice.tenantId, tenantId));

				const existingInvoice = potentialInvoices.find(inv =>
					normalizeInvoiceNumber(inv.invoiceNumber) === normalizedInvoiceNumber
				);


				// Normalize VAT ID for comparison
				const customerVatId = normalizeVatId(ublData.customer.vatId);

				// Find or create client, and update with latest data from invoice
				let clientId: string;

				if (existingInvoice) {
					clientId = existingInvoice.clientId;

					// Update existing client with fresh data from invoice
					await db
						.update(table.client)
						.set({
							name: ublData.customer.name,
							vatNumber: ublData.customer.vatId,
							registrationNumber: ublData.customer.taxId || undefined,
							address: ublData.customer.address || undefined,
							city: ublData.customer.city || undefined,
							county: ublData.customer.county || undefined,
							postalCode: ublData.customer.postalCode || undefined,
							country: ublData.customer.country || 'România',
							email: ublData.customer.email || undefined,
							iban: ublData.customer.iban || undefined,
							bankName: ublData.customer.bankName || undefined,
							updatedAt: new Date()
						})
						.where(eq(table.client.id, clientId));
				} else {
					// Try to find existing client by CUI, VAT number, or registration number
					// (check both with and without RO prefix, and also check if registration number was mistakenly stored in vatNumber)
					const [existingClient] = await db
						.select()
						.from(table.client)
						.where(
							and(
								eq(table.client.tenantId, tenantId),
								or(
									eq(table.client.cui, customerVatId),
									eq(table.client.cui, ublData.customer.vatId),
									eq(table.client.vatNumber, customerVatId),
									eq(table.client.vatNumber, ublData.customer.vatId),
									// Also check if registration number (J...) was mistakenly stored in vatNumber
									ublData.customer.taxId ? eq(table.client.vatNumber, ublData.customer.taxId) : sql`false`,
									ublData.customer.taxId ? eq(table.client.registrationNumber, ublData.customer.taxId) : sql`false`
								)
							)
						)
						.limit(1);

					if (existingClient) {
						clientId = existingClient.id;

						// Check if existing client has incorrect data (registration number in wrong fields)
						const needsCorrection =
							(existingClient.cui && existingClient.cui.startsWith('J')) ||
							(existingClient.vatNumber && existingClient.vatNumber.startsWith('J'));

						if (needsCorrection) {
							logWarning('anaf-spv', `Client ${existingClient.name} has incorrect data (J... in CUI/VAT fields), correcting`, { tenantId, metadata: { clientId: existingClient.id } });
						}

						// Update existing client with fresh data from invoice
						// Always update CUI to ensure it's correct (numeric only, no RO prefix)
						await db
							.update(table.client)
							.set({
								name: ublData.customer.name,
								cui: customerVatId, // Always set correct CUI
								vatNumber: ublData.customer.vatId,
								registrationNumber: ublData.customer.taxId || undefined,
								address: ublData.customer.address || undefined,
								city: ublData.customer.city || undefined,
								county: ublData.customer.county || undefined,
								postalCode: ublData.customer.postalCode || undefined,
								country: ublData.customer.country || 'România',
								email: ublData.customer.email || undefined,
								iban: ublData.customer.iban || undefined,
								bankName: ublData.customer.bankName || undefined,
								updatedAt: new Date()
							})
							.where(eq(table.client.id, clientId));
					} else {
						// Get company data from ANAF
						const companyData = await spvClient.getCompanyFromAnaf(ublData.customer.vatId);

						if (!companyData) {
						// Create client with minimal data from invoice
						const newClientId = generateClientId();
						await db.insert(table.client).values({
							id: newClientId,
							tenantId: tenantId,
							name: ublData.customer.name,
							cui: customerVatId,
							vatNumber: ublData.customer.vatId,
							registrationNumber: ublData.customer.taxId || null,
							address: ublData.customer.address,
							city: ublData.customer.city,
							county: ublData.customer.county,
							postalCode: ublData.customer.postalCode,
							country: ublData.customer.country || 'România',
							email: ublData.customer.email,
							iban: ublData.customer.iban,
							bankName: ublData.customer.bankName,
							status: 'active'
						});
						clientId = newClientId;
						} else {
							// Create client from ANAF data with bank info
							const clientData = mapAnafCompanyToClient(companyData, tenantId, {
								iban: ublData.customer.iban,
								bankName: ublData.customer.bankName
							});
							const newClientId = generateClientId();
							await db.insert(table.client).values({
								id: newClientId,
								...clientData
							});
							clientId = newClientId;
						}
					}
				}

				// Map UBL invoice to CRM invoice format
				const invoiceData = mapUblInvoiceToCrm(ublData, tenantId, systemUserId, clientId);

				let invoiceId: string;

				if (existingInvoice) {
					// Update existing invoice with SPV data
					invoiceId = existingInvoice.id;

					logInfo('anaf-spv', `Found existing invoice ${existingInvoice.invoiceNumber}, keeping format (SPV has: "${ublData.invoiceNumber}")`, { tenantId, metadata: { invoiceId, spvId: spvInvoice.id } });

					await db
						.update(table.invoice)
						.set({
							spvId: spvInvoice.id, // Add SPV ID
							// Do NOT update invoiceNumber - keep the existing format
							status: invoiceData.status,
							amount: invoiceData.amount,
							taxRate: invoiceData.taxRate,
							taxAmount: invoiceData.taxAmount,
							totalAmount: invoiceData.totalAmount,
							issueDate: invoiceData.issueDate,
							dueDate: invoiceData.dueDate,
							currency: invoiceData.currency,
							updatedAt: new Date()
						})
						.where(eq(table.invoice.id, existingInvoice.id));

					// Always sync line items to keep them up to date
					const existingLineItems = await db
						.select()
						.from(table.invoiceLineItem)
						.where(eq(table.invoiceLineItem.invoiceId, existingInvoice.id));

					logInfo('anaf-spv', `Line items sync: ${existingLineItems.length} existing, ${invoiceData.lineItems.length} from SPV`, { tenantId, metadata: { invoiceId } });

					if (existingLineItems.length === 0 && invoiceData.lineItems.length > 0) {
					// Invoice has no line items, add them
					logWarning('anaf-spv', `Invoice has no line items, adding ${invoiceData.lineItems.length} items`, { tenantId, metadata: { invoiceId } });

					for (const [index, lineItem] of invoiceData.lineItems.entries()) {
						const lineItemId = generateLineItemId();
						const { invoiceId: _unused, ...lineItemData } = lineItem;

						await db.insert(table.invoiceLineItem).values({
							id: lineItemId,
							invoiceId: invoiceId,
							...lineItemData
						});
					}

						// Verify - count final line items
						const finalLineItems = await db
							.select()
							.from(table.invoiceLineItem)
							.where(eq(table.invoiceLineItem.invoiceId, existingInvoice.id));

						logInfo('anaf-spv', `Added ${finalLineItems.length} line items to existing invoice (expected: ${invoiceData.lineItems.length})`, { tenantId, metadata: { invoiceId } });

						if (finalLineItems.length !== invoiceData.lineItems.length) {
							logError('anaf-spv', `Line item count mismatch after adding! Expected ${invoiceData.lineItems.length}, got ${finalLineItems.length}`, { tenantId, metadata: { invoiceId } });
						}
					} else if (existingLineItems.length > 0) {
						// Line items exist - always recreate to ensure sync
						logInfo('anaf-spv', `Recreating ${invoiceData.lineItems.length} line items (deleting ${existingLineItems.length} existing)`, { tenantId, metadata: { invoiceId } });

						// Delete ALL existing line items first to prevent duplicates
						const deletedCount = await db
							.delete(table.invoiceLineItem)
							.where(eq(table.invoiceLineItem.invoiceId, existingInvoice.id));

						// Verify deletion - double check no line items remain
						const remainingLineItems = await db
							.select()
							.from(table.invoiceLineItem)
							.where(eq(table.invoiceLineItem.invoiceId, existingInvoice.id));

						if (remainingLineItems.length > 0) {
							logError('anaf-spv', `${remainingLineItems.length} line items still exist after deletion, aborting sync to prevent duplicates`, { tenantId, metadata: { invoiceId } });
							throw new Error(`Failed to delete line items for invoice ${existingInvoice.id}`);
						}

					// Create new line items
					for (const [index, lineItem] of invoiceData.lineItems.entries()) {
						const lineItemId = generateLineItemId();
						const { invoiceId: _unused, ...lineItemData } = lineItem;

						await db.insert(table.invoiceLineItem).values({
							id: lineItemId,
							invoiceId: invoiceId,
							...lineItemData
						});
					}

						// Final verification - count line items
						const finalLineItems = await db
							.select()
							.from(table.invoiceLineItem)
							.where(eq(table.invoiceLineItem.invoiceId, existingInvoice.id));

						logInfo('anaf-spv', `Synced ${finalLineItems.length} line items (expected: ${invoiceData.lineItems.length})`, { tenantId, metadata: { invoiceId } });

						if (finalLineItems.length !== invoiceData.lineItems.length) {
							logError('anaf-spv', `Line item count mismatch after sync! Expected ${invoiceData.lineItems.length}, got ${finalLineItems.length}`, { tenantId, metadata: { invoiceId } });
						}
					}

					updated++;
				} else {
					// Create new invoice
					invoiceId = generateInvoiceId();
					await db.insert(table.invoice).values({
						id: invoiceId,
						...invoiceData,
						spvId: spvInvoice.id // Store SPV ID in invoice
					});

				// Create line items
				for (const [index, lineItem] of invoiceData.lineItems.entries()) {
					const lineItemId = generateLineItemId();
					const { invoiceId: _unused, ...lineItemData } = lineItem;

					await db.insert(table.invoiceLineItem).values({
						id: lineItemId,
						invoiceId: invoiceId,
						...lineItemData
					});
				}

				logInfo('anaf-spv', `Created new invoice with ${invoiceData.lineItems.length} line items`, { tenantId, metadata: { invoiceId, invoiceNumber: ublData.invoiceNumber, spvId: spvInvoice.id } });

					imported++;
				}

				// Upload XML file to MinIO
				const xmlBuffer = Buffer.from(xml, 'utf-8');
				const xmlUpload = await uploadBuffer(
					tenantId,
					xmlBuffer,
					`factura-${ublData.invoiceNumber}-${spvInvoice.id}.xml`,
					'application/xml',
					{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
				);

				// Convert UBL to PDF and upload
				let pdfPath: string | null = null;
				try {
					const pdfBuffer = await spvClient.ublToPdf(xml, `Invoice ${ublData.invoiceNumber}`);
					if (pdfBuffer) {
						const pdfUpload = await uploadBuffer(
							tenantId,
							pdfBuffer,
							`factura-${ublData.invoiceNumber}-${spvInvoice.id}.pdf`,
							'application/pdf',
							{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
						);
						pdfPath = pdfUpload.path;

						// Update invoice with PDF path (optional: you can add a pdfPath field to invoice table)
						// For now we just store it in MinIO, accessible via file browser
					}
				} catch (pdfError) {
					const err = serializeError(pdfError);
					logError('anaf-spv', `Failed to convert UBL to PDF for invoice ${spvInvoice.id}: ${err.message}`, { tenantId, stackTrace: err.stack });
					// Continue even if PDF conversion fails
				}

				// Create or update sync record for invoice
				const [existingSync] = await db
					.select()
					.from(table.anafSpvInvoiceSync)
					.where(
						and(
							eq(table.anafSpvInvoiceSync.invoiceId, invoiceId),
							eq(table.anafSpvInvoiceSync.syncDirection, 'pull-sent')
						)
					)
					.limit(1);

				if (existingSync) {
					// Update existing sync record
					await db
						.update(table.anafSpvInvoiceSync)
						.set({
							spvId: spvInvoice.id,
							lastSyncedAt: new Date(),
							syncStatus: 'synced',
							updatedAt: new Date()
						})
						.where(eq(table.anafSpvInvoiceSync.id, existingSync.id));
				} else {
					// Create new sync record
					const syncId = generateSyncId();
					await db.insert(table.anafSpvInvoiceSync).values({
						id: syncId,
						invoiceId: invoiceId, // Store invoiceId for sent invoice sync
						expenseId: null, // Only set for expense (received) operations
						tenantId: tenantId,
						spvId: spvInvoice.id,
						syncDirection: 'pull-sent', // New direction for pulling sent invoices
						lastSyncedAt: new Date(),
						syncStatus: 'synced'
					});
				}
			} catch (error) {
				const err = serializeError(error);
				logError('anaf-spv', `Failed to sync sent invoice ${spvInvoice.id}: ${err.message}`, { tenantId, stackTrace: err.stack });
				errors++;

				// Create error sync record
				try {
					const syncId = generateSyncId();
					await db.insert(table.anafSpvInvoiceSync).values({
						id: syncId,
						invoiceId: null, // No invoice created - nullable for error records
						expenseId: null,
						tenantId: tenantId,
						spvId: spvInvoice.id,
						syncDirection: 'pull-sent',
						syncStatus: 'error',
						errorMessage: error instanceof Error ? error.message : String(error)
					});
				} catch (syncError) {
					const err2 = serializeError(syncError);
					logError('anaf-spv', `Failed to create error sync record: ${err2.message}`, { tenantId, stackTrace: err2.stack });
				}
			}
		}

		// Update integration last sync time
		await db
			.update(table.anafSpvIntegration)
			.set({
				lastSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.anafSpvIntegration.id, integration.id));

		return {
			success: true,
			imported,
			updated,
			skipped,
			errors
		};
	} catch (error) {
		const err = serializeError(error);
		logError('anaf-spv', `Failed to sync sent invoices for tenant ${tenantId}: ${err.message}`, { tenantId, stackTrace: err.stack });
		throw error;
	}
}
