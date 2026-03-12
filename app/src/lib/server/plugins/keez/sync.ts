import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createKeezClientForTenant } from './factory';
import { mapKeezInvoiceToCRM, mapKeezDetailsToLineItems, findOrCreateClientForKeezPartner } from './mapper';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

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

	// Get tenant owner userId for new invoice imports (createdByUserId is NOT NULL)
	const [tenantOwner] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.role, 'owner')))
		.limit(1);
	const systemUserId = tenantOwner?.userId || '';

	// Get invoices from Keez
	const response = await keezClient.getInvoices({
		offset: options?.offset,
		count: options?.count || 500,
		filter: options?.filter
	});

	logInfo('keez', `Sync fetched ${response.data?.length || 0} invoices (recordsCount: ${response.recordsCount}, total: ${response.total ?? 'N/A'}) [${response.first}-${response.last}]`, { tenantId });

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
					logWarning('keez', `Sync skipping invoice ${invoiceHeader.externalId} - not found in Keez`, { tenantId });
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

				// Determine status based on Keez status + remainingAmount
				const keezStatus = invoiceHeader.status || keezInvoice.status;
				let invoiceStatus: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' =
					existing.status as any;

				if (keezStatus === 'Cancelled') {
					invoiceStatus = 'cancelled';
				} else if (keezStatus === 'Draft') {
					// Proforma — keep as draft, do NOT mark as paid
					invoiceStatus = 'draft';
				} else if (keezStatus === 'Valid') {
					// Validated fiscal invoice — check remainingAmount
					if (invoiceHeader.remainingAmount !== undefined) {
						const remainingCents = Math.round(invoiceHeader.remainingAmount * 100);
						if (remainingCents === 0) {
							invoiceStatus = 'paid';
						} else if (remainingCents > 0) {
							const dueDate = parsedDueDate || existing.dueDate;
							invoiceStatus = dueDate && dueDate < new Date() ? 'overdue' : 'sent';
						}
					} else {
						invoiceStatus = 'sent';
					}
				} else if (invoiceHeader.remainingAmount !== undefined) {
					// Fallback for unknown status
					const remainingCents = Math.round(invoiceHeader.remainingAmount * 100);
					if (remainingCents === 0 && keezStatus) {
						invoiceStatus = 'paid';
					} else if (remainingCents > 0) {
						const dueDate = parsedDueDate || existing.dueDate;
						invoiceStatus = dueDate && dueDate < new Date() ? 'overdue' : 'sent';
					}
				}

				// Calculate totals from Keez — try detail lines first, then invoice-level, then header
				let keezNetAmount = 0;
				let keezVatAmount = 0;
				let keezGrossAmount = 0;
				let keezTaxRate: number | null = null;

				// Use HEADER-level amounts (always RON, even for EUR invoices)
				// Detail-level amounts return EUR for multi-currency invoices (unreliable)
				keezNetAmount = invoiceHeader.netAmount ?? 0;
				keezVatAmount = invoiceHeader.vatAmount ?? 0;
				keezGrossAmount = invoiceHeader.grossAmount ?? 0;

				// Determine currency context
				const invoiceCurrencyCode = keezInvoice?.currencyCode || keezInvoice?.currency || invoiceHeader.currencyCode || invoiceHeader.currency;
				const hasRealExchangeRate = keezInvoice.exchangeRate && keezInvoice.exchangeRate > 1;
				const isNonRonInvoice = invoiceCurrencyCode && invoiceCurrencyCode !== 'RON';
				const detailHasRonBreakdown = !!keezInvoice.invoiceDetails?.[0]?.netAmountCurrency;

				// If EUR invoice has detail-level RON breakdown, use RON amounts from details
				if (isNonRonInvoice && detailHasRonBreakdown) {
					keezNetAmount = 0;
					keezVatAmount = 0;
					keezGrossAmount = 0;
					for (const detail of keezInvoice.invoiceDetails) {
						keezNetAmount += detail.netAmount ?? 0;
						keezVatAmount += detail.vatAmount ?? 0;
						keezGrossAmount += detail.grossAmount ?? 0;
					}
				}

				// Extract tax rate from details
				if (Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0) {
					for (const detail of keezInvoice.invoiceDetails) {
						if (keezTaxRate === null && detail.vatPercent != null) {
							keezTaxRate = detail.vatPercent;
						}
					}
				}

				// Fallback: invoice-level totals if header has no amounts
				if (keezGrossAmount === 0) {
					keezNetAmount = keezInvoice.netAmount ?? keezInvoice.netAmountCurrency ?? 0;
					keezVatAmount = keezInvoice.vatAmount ?? keezInvoice.vatAmountCurrency ?? 0;
					keezGrossAmount = keezInvoice.grossAmount ?? keezInvoice.grossAmountCurrency ?? 0;
				}

				const updateData: any = { updatedAt: new Date(), taxApplicationType: existing.taxApplicationType || 'apply' };

				if (parsedIssueDate) updateData.issueDate = parsedIssueDate;
				if (parsedDueDate) updateData.dueDate = parsedDueDate;
				if (invoiceStatus !== existing.status) updateData.status = invoiceStatus;
				if (invoiceStatus === 'paid' && !existing.paidDate) updateData.paidDate = new Date();
				if (keezStatus && keezStatus !== existing.keezStatus) updateData.keezStatus = keezStatus;

				if (invoiceHeader.series && invoiceHeader.number) {
					const newNumber = `${invoiceHeader.series} ${invoiceHeader.number}`;
					if (newNumber !== existing.invoiceNumber) updateData.invoiceNumber = newNumber;
				}

				// Currency logic:
				// - If EUR invoice has real exchange rate OR detail-level RON amounts → store as RON
				// - If EUR invoice has exchangeRate=1 and no RON breakdown → amounts ARE in EUR
				if (isNonRonInvoice) {
					if (hasRealExchangeRate || detailHasRonBreakdown) {
						updateData.currency = 'RON';
						updateData.invoiceCurrency = invoiceCurrencyCode;
						if (keezInvoice.exchangeRate) {
							updateData.exchangeRate = String(keezInvoice.exchangeRate);
						}
					} else {
						// Amounts are in EUR (no RON conversion available from Keez)
						updateData.currency = invoiceCurrencyCode;
						updateData.invoiceCurrency = null;
						updateData.exchangeRate = null;
					}
				} else {
					if (existing.currency !== 'RON') {
						updateData.currency = 'RON';
					}
				}

				if (keezNetAmount > 0 || keezVatAmount > 0 || keezGrossAmount > 0) {
					const newTotalCents = Math.round(keezGrossAmount * 100);
					if (newTotalCents !== existing.totalAmount) {
						logInfo('keez', `Sync amount update ${existing.invoiceNumber}: ${existing.totalAmount} -> ${newTotalCents} (Keez gross: ${keezGrossAmount})`, { tenantId, metadata: { invoiceId: existing.id, oldAmount: existing.totalAmount, newAmount: newTotalCents } });
					}
					updateData.amount = Math.round(keezNetAmount * 100);
					updateData.taxAmount = Math.round(keezVatAmount * 100);
					updateData.totalAmount = newTotalCents;
				}

				if (keezTaxRate !== null) {
					updateData.taxRate = Math.round(keezTaxRate * 100);
				}

				if (keezInvoice.notes) updateData.notes = keezInvoice.notes;

				// Re-match client using CUI-first logic to fix wrong associations
				if (keezInvoice.partner) {
					const correctClientId = await findOrCreateClientForKeezPartner(
						keezInvoice.partner,
						tenantId
					);
					if (correctClientId && correctClientId !== existing.clientId) {
						updateData.clientId = correctClientId;
						logInfo('keez', `Sync re-matched invoice ${existing.invoiceNumber}: client ${existing.clientId} -> ${correctClientId}`, { tenantId, metadata: { invoiceId: existing.id, oldClientId: existing.clientId, newClientId: correctClientId, cui: keezInvoice.partner.identificationNumber || 'N/A' } });
					}
				}

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
						const lineErr = serializeError(lineItemError);
						logError('keez', `Sync failed to update line items for invoice ${existing.id}: ${lineErr.message}`, { tenantId, stackTrace: lineErr.stack });
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

			// New invoice - find or create client (CUI-first matching)
			let clientId: string | null = null;
			if (keezInvoice.partner) {
				clientId = await findOrCreateClientForKeezPartner(keezInvoice.partner, tenantId);
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

			const invoiceInsertData = invoiceData;
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
				invoiceCurrency: invoiceInsertData.invoiceCurrency || null,
				exchangeRate: invoiceInsertData.exchangeRate || null,
				issueDate: invoiceInsertData.issueDate ?? new Date(),
				dueDate: invoiceInsertData.dueDate ?? null,
				notes: invoiceInsertData.notes || null,
				keezInvoiceId: invoiceInsertData.keezInvoiceId || null,
				keezExternalId: invoiceInsertData.keezExternalId || null,
				keezStatus: invoiceInsertData.keezStatus || null,
				taxApplicationType: 'apply',
				createdByUserId: systemUserId
			});

			if (Array.isArray(keezInvoice.invoiceDetails) && keezInvoice.invoiceDetails.length > 0) {
				try {
					const lineItemsData = mapKeezDetailsToLineItems(keezInvoice.invoiceDetails, invoiceId);
					if (lineItemsData.length > 0) {
						await db.insert(table.invoiceLineItem).values(
							lineItemsData.map((item) => ({
								...item,
								id: generateId()
							}))
						);
					}
				} catch (lineItemError) {
					const lineErr = serializeError(lineItemError);
					logError('keez', `Sync failed to insert line items for new invoice ${invoiceId}: ${lineErr.message}`, { tenantId, stackTrace: lineErr.stack });
				}
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
			const processErr = serializeError(error);
			logError('keez', `Sync failed to process invoice ${invoiceHeader.externalId}: ${processErr.message}`, { tenantId, stackTrace: processErr.stack });
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
