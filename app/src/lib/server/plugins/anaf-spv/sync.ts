/**
 * Internal SPV invoice sync function for scheduled tasks
 * This function can be called without request event context
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { AnafSpvClient } from './client';
import { decrypt } from './crypto';
import { parseUblInvoice } from './xml-parser';
import { mapUblInvoiceToExpense, mapAnafCompanyToSupplier, normalizeVatId } from './mapper';
import { uploadBuffer } from '$lib/server/storage';
import { encodeBase32LowerCase } from '@oslojs/encoding';

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

				// Find or create supplier (these are expenses, not invoices we generated)
				let supplierId: string;

				// Normalize VAT ID for comparison
				const supplierVatId = normalizeVatId(ublData.supplier.vatId);

				// Try to find existing supplier by CUI or VAT code
				const [existingSupplier] = await db
					.select()
					.from(table.supplier)
					.where(and(eq(table.supplier.tenantId, tenantId), eq(table.supplier.cui, supplierVatId)))
					.limit(1);

				if (existingSupplier) {
					supplierId = existingSupplier.id;
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
							email: ublData.supplier.email
						});
						supplierId = newSupplierId;
					} else {
						// Create supplier from ANAF data
						const supplierData = mapAnafCompanyToSupplier(companyData, tenantId);
						const newSupplierId = generateSupplierId();
						await db.insert(table.supplier).values({
							id: newSupplierId,
							...supplierData
						});
						supplierId = newSupplierId;
					}
				}

				// Map UBL invoice to expense format
				const expenseData = mapUblInvoiceToExpense(ublData, tenantId, systemUserId, supplierId);

				// Create expense
				const expenseId = generateExpenseId();
				await db.insert(table.expense).values({
					id: expenseId,
					...expenseData
				});

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
					console.error(
						`[ANAF-SPV] Failed to convert UBL to PDF for invoice ${spvInvoice.id}:`,
						pdfError
					);
					// Continue even if PDF conversion fails
				}

				// Create sync record for expense
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

				imported++;
			} catch (error) {
				console.error(`[ANAF-SPV] Failed to sync invoice ${spvInvoice.id}:`, error);
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
					console.error(`[ANAF-SPV] Failed to create error sync record:`, syncError);
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
			skipped,
			errors
		};
	} catch (error) {
		console.error(`[ANAF-SPV] Failed to sync invoices for tenant ${tenantId}:`, error);
		throw error;
	}
}
