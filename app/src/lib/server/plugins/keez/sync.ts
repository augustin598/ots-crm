import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createKeezClientForTenant } from './factory';
import { mapKeezInvoiceToCRM, mapKeezPartnerToClient, mapKeezDetailsToLineItems } from './mapper';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Parse Keez date format (YYYYMMDD as number or string)
 */
function parseKeezDate(dateValue: string | number | undefined): Date | null {
	if (dateValue === null || dateValue === undefined) {
		return null;
	}

	try {
		if (typeof dateValue === 'number') {
			const dateNum = dateValue;
			if (dateNum >= 10000101 && dateNum <= 99991231) {
				const dateStr = String(dateNum);
				const year = parseInt(dateStr.substring(0, 4), 10);
				const month = parseInt(dateStr.substring(4, 6), 10) - 1;
				const day = parseInt(dateStr.substring(6, 8), 10);
				const date = new Date(year, month, day);
				if (!isNaN(date.getTime()) && date.getFullYear() === year) {
					return date;
				}
			}
			return null;
		}

		const dateStrTrimmed = String(dateValue).trim();
		if (
			!dateStrTrimmed ||
			dateStrTrimmed === 'null' ||
			dateStrTrimmed === 'undefined' ||
			dateStrTrimmed === '0000-00-00'
		) {
			return null;
		}

		const date = new Date(dateStrTrimmed);
		if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
			return date;
		}
		return null;
	} catch {
		return null;
	}
}

export interface SyncKeezInvoicesResult {
	imported: number;
	updated: number;
	skipped: number;
	errors: number;
}

/**
 * Sync invoices from Keez for a specific tenant.
 * Can be called from the scheduler (no request context needed).
 */
export async function syncKeezInvoicesForTenant(
	tenantId: string,
	options?: { offset?: number; count?: number; filter?: string }
): Promise<SyncKeezInvoicesResult> {
	const result: SyncKeezInvoicesResult = { imported: 0, updated: 0, skipped: 0, errors: 0 };

	// Get integration
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);

	if (!integration) {
		return result;
	}

	const keezClient = await createKeezClientForTenant(tenantId, integration);

	// Get invoices from Keez
	const response = await keezClient.getInvoices({
		offset: options?.offset,
		count: options?.count || 100,
		filter: options?.filter
	});

	for (const invoiceHeader of response.data || []) {
		try {
			// Check if invoice already exists in CRM
			const [existing] = await db
				.select()
				.from(table.invoice)
				.where(eq(table.invoice.keezExternalId, invoiceHeader.externalId))
				.limit(1);

			// Get full invoice details from Keez
			let keezInvoice;
			try {
				keezInvoice = await keezClient.getInvoice(invoiceHeader.externalId);
			} catch (e) {
				if (e instanceof Error && e.message === 'Not found') {
					console.warn(
						`[Keez-Sync] Skipping invoice ${invoiceHeader.externalId} - not found in Keez`
					);
					result.skipped++;
					continue;
				}
				throw e;
			}

			if (existing) {
				// Update existing invoice with latest data from Keez
				const issueDateSource =
					invoiceHeader.documentDate || invoiceHeader.issueDate || keezInvoice.issueDate;
				const parsedIssueDate = parseKeezDate(issueDateSource);
				const parsedDueDate = parseKeezDate(invoiceHeader.dueDate || keezInvoice.dueDate);

				// Determine status based on remainingAmount
				let invoiceStatus: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' =
					existing.status as any;

				if (invoiceHeader.remainingAmount !== undefined) {
					const remainingCents = Math.round(invoiceHeader.remainingAmount * 100);
					if (remainingCents === 0) {
						invoiceStatus = 'paid';
					} else if (remainingCents > 0) {
						const dueDate = parsedDueDate || existing.dueDate;
						invoiceStatus = dueDate && dueDate < new Date() ? 'overdue' : 'sent';
					}
				}

				// Calculate totals from Keez invoice details
				let keezNetAmount = 0;
				let keezVatAmount = 0;
				let keezGrossAmount = 0;
				let keezTaxRate: number | null = null;

				if (Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0) {
					for (const detail of keezInvoice.invoiceDetails) {
						const netAmount = detail.netAmountCurrency ?? detail.netAmount ?? 0;
						const vatAmount = detail.vatAmountCurrency ?? detail.vatAmount ?? 0;
						const grossAmount = detail.grossAmountCurrency ?? detail.grossAmount ?? 0;
						keezNetAmount += netAmount;
						keezVatAmount += vatAmount;
						keezGrossAmount += grossAmount;
						if (keezTaxRate === null && detail.vatPercent != null) {
							keezTaxRate = detail.vatPercent;
						}
					}
				}

				const updateData: any = { updatedAt: new Date() };

				if (parsedIssueDate) updateData.issueDate = parsedIssueDate;
				if (parsedDueDate) updateData.dueDate = parsedDueDate;
				if (invoiceStatus !== existing.status) updateData.status = invoiceStatus;
				if (invoiceStatus === 'paid' && !existing.paidDate) updateData.paidDate = new Date();

				if (invoiceHeader.series && invoiceHeader.number) {
					const newNumber = `${invoiceHeader.series} ${invoiceHeader.number}`;
					if (newNumber !== existing.invoiceNumber) updateData.invoiceNumber = newNumber;
				}

				if (invoiceHeader.currency && invoiceHeader.currency !== existing.currency) {
					updateData.currency = invoiceHeader.currency;
				}

				if (keezNetAmount > 0 || keezVatAmount > 0 || keezGrossAmount > 0) {
					updateData.amount = Math.round(keezNetAmount * 100);
					updateData.taxAmount = Math.round(keezVatAmount * 100);
					updateData.totalAmount = Math.round(keezGrossAmount * 100);
				}

				if (keezTaxRate !== null) {
					updateData.taxRate = Math.round(keezTaxRate * 100);
				}

				if (keezInvoice.notes) updateData.notes = keezInvoice.notes;

				await db.update(table.invoice).set(updateData).where(eq(table.invoice.id, existing.id));

				// Update line items
				if (Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0) {
					try {
						await db
							.delete(table.invoiceLineItem)
							.where(eq(table.invoiceLineItem.invoiceId, existing.id));
						const lineItemsData = mapKeezDetailsToLineItems(keezInvoice.invoiceDetails, existing.id);
						if (lineItemsData.length > 0) {
							await db.insert(table.invoiceLineItem).values(
								lineItemsData.map((item) => ({
									...item,
									id: generateId()
								}))
							);
						}
					} catch (lineItemError) {
						console.error(
							`[Keez-Sync] Failed to update line items for invoice ${existing.id}:`,
							lineItemError
						);
					}
				}

				// Update or create sync record
				const [existingSync] = await db
					.select()
					.from(table.keezInvoiceSync)
					.where(eq(table.keezInvoiceSync.invoiceId, existing.id))
					.limit(1);

				if (existingSync) {
					await db
						.update(table.keezInvoiceSync)
						.set({
							keezInvoiceId: invoiceHeader.externalId,
							keezExternalId: invoiceHeader.externalId,
							syncDirection: 'pull',
							syncStatus: 'synced',
							lastSyncedAt: new Date()
						})
						.where(eq(table.keezInvoiceSync.id, existingSync.id));
				} else {
					await db.insert(table.keezInvoiceSync).values({
						id: generateId(),
						invoiceId: existing.id,
						tenantId,
						keezInvoiceId: invoiceHeader.externalId,
						keezExternalId: invoiceHeader.externalId,
						syncDirection: 'pull',
						syncStatus: 'synced',
						lastSyncedAt: new Date()
					});
				}

				result.updated++;
				continue;
			}

			// New invoice - find or create client
			let clientId: string | null = null;
			if (keezInvoice.partner?.partnerName) {
				const partnerName = keezInvoice.partner.partnerName;
				const [existingClient] = await db
					.select()
					.from(table.client)
					.where(
						and(
							eq(table.client.tenantId, tenantId),
							or(eq(table.client.name, partnerName), eq(table.client.businessName, partnerName))
						)
					)
					.limit(1);

				if (existingClient) {
					clientId = existingClient.id;
				} else if (keezInvoice.partner) {
					const newClientId = generateId();
					const clientData = mapKeezPartnerToClient(keezInvoice.partner, tenantId);
					await db.insert(table.client).values({ id: newClientId, ...clientData });
					clientId = newClientId;
				}
			}

			if (!clientId) {
				result.skipped++;
				continue;
			}

			// Map and create invoice
			const invoiceData = mapKeezInvoiceToCRM(
				keezInvoice,
				invoiceHeader,
				tenantId,
				clientId,
				'' // No user for scheduler-triggered imports
			);

			const { lineItems, ...invoiceInsertData } = invoiceData;
			const invoiceId = generateId();

			await db.insert(table.invoice).values({
				id: invoiceId,
				tenantId: invoiceInsertData.tenantId || tenantId,
				clientId: invoiceInsertData.clientId || clientId,
				invoiceNumber: invoiceInsertData.invoiceNumber || invoiceHeader.externalId,
				status: invoiceInsertData.status || 'sent',
				amount: invoiceInsertData.amount || 0,
				taxRate: invoiceInsertData.taxRate || 1900,
				taxAmount: invoiceInsertData.taxAmount || 0,
				totalAmount: invoiceInsertData.totalAmount || 0,
				currency: invoiceInsertData.currency || 'RON',
				issueDate: invoiceInsertData.issueDate ?? new Date(),
				dueDate: invoiceInsertData.dueDate ?? null,
				notes: invoiceInsertData.notes || null,
				keezInvoiceId: invoiceInsertData.keezInvoiceId || null,
				keezExternalId: invoiceInsertData.keezExternalId || null,
				createdByUserId: null
			});

			if (lineItems && lineItems.length > 0) {
				await db.insert(table.invoiceLineItem).values(
					lineItems.map((item) => ({
						...item,
						invoiceId,
						id: generateId()
					}))
				);
			}

			// Create sync record
			await db.insert(table.keezInvoiceSync).values({
				id: generateId(),
				invoiceId,
				tenantId,
				keezInvoiceId: invoiceHeader.externalId,
				keezExternalId: invoiceHeader.externalId,
				syncDirection: 'pull',
				syncStatus: 'synced',
				lastSyncedAt: new Date()
			});

			result.imported++;
		} catch (error) {
			console.error(`[Keez-Sync] Failed to process invoice ${invoiceHeader.externalId}:`, error);
			result.errors++;
		}
	}

	// Update integration last sync time
	await db
		.update(table.keezIntegration)
		.set({ lastSyncAt: new Date(), updatedAt: new Date() })
		.where(eq(table.keezIntegration.tenantId, tenantId));

	return result;
}
