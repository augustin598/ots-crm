import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getHooksManager } from './plugins/hooks';
import { generateKeezInvoiceNumber, extractInvoiceNumber } from '$lib/utils/invoice';
import { KeezClient } from './plugins/keez/client';
import { decrypt } from './plugins/keez/crypto';
import { generateNextInvoiceNumber as generateNextKeezInvoiceNumber } from './plugins/keez/mapper';
import { generateNextInvoiceNumber as generateNextSmartBillInvoiceNumber } from './plugins/smartbill/mapper';
import { logInfo, logWarning } from '$lib/server/logger';

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Generate invoice number based on Keez settings if configured
 * Falls back to default format if Keez is not configured
 */
export async function generateInvoiceNumber(tenantId: string): Promise<string> {
	// Check if Keez integration is active
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);

	if (!integration) {
		// No Keez integration, use default format
		return `INV-${Date.now()}`;
	}

	// Get invoice settings
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	if (!settings?.keezSeries) {
		// Keez series not configured, use default format
		return `INV-${Date.now()}`;
	}

	const series = settings.keezSeries.trim();
	if (!series) {
		return `INV-${Date.now()}`;
	}

	// Try to get next number from Keez API
	try {
		const secret = decrypt(tenantId, integration.secret);
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		const nextNumber = await keezClient.getNextInvoiceNumber(series);
		if (nextNumber !== null) {
			logInfo('keez', `Keez next number: serie=${series}, număr=${nextNumber}`, { tenantId, action: 'keez_next_number' });
			return generateKeezInvoiceNumber(series, nextNumber);
		}
	} catch (error) {
		logWarning('server', `Failed to get next number from Keez, using fallback`, { tenantId, stackTrace: error instanceof Error ? error.stack : undefined });
	}

	// Fallback: use last synced number or start number
	let nextNum: string;
	if (settings.keezLastSyncedNumber) {
		// Extract numeric part and increment
		const numericPart = extractInvoiceNumber(settings.keezLastSyncedNumber);
		nextNum = generateNextKeezInvoiceNumber(numericPart);
	} else if (settings.keezStartNumber) {
		// Use start number
		nextNum = extractInvoiceNumber(settings.keezStartNumber);
	} else {
		// No start number, default to 1
		nextNum = '1';
	}

	return generateKeezInvoiceNumber(series, nextNum);
}

/**
 * Get the next invoice number from plugin settings based on the provided series
 * Checks both Keez and SmartBill integrations
 * @param tenantId - Tenant ID
 * @param series - Invoice series (optional, if provided will match against plugin series)
 * @returns Next invoice number with series, or null if no matching plugin found
 */
export async function getNextInvoiceNumberFromPlugin(
	tenantId: string,
	series?: string
): Promise<string | null> {
	// Get invoice settings
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	if (!settings) {
		return null;
	}

	// Check Keez integration first
	if (settings.keezSeries) {
		const keezSeries = settings.keezSeries.trim();
		// If series is provided, only use Keez if it matches
		if (!series || keezSeries === series) {
			// Check if Keez integration is active
			const [keezIntegration] = await db
				.select()
				.from(table.keezIntegration)
				.where(
					and(
						eq(table.keezIntegration.tenantId, tenantId),
						eq(table.keezIntegration.isActive, true)
					)
				)
				.limit(1);

			if (keezIntegration) {
				// Try to get next number from Keez API
				try {
					const secret = decrypt(tenantId, keezIntegration.secret);
					const keezClient = new KeezClient({
						clientEid: keezIntegration.clientEid,
						applicationId: keezIntegration.applicationId,
						secret
					});

					const nextNumber = await keezClient.getNextInvoiceNumber(keezSeries);
					if (nextNumber !== null) {
						logInfo('keez', `Keez plugin next number: serie=${keezSeries}, număr=${nextNumber}`, { tenantId, action: 'keez_plugin_next_number' });
						return generateKeezInvoiceNumber(keezSeries, nextNumber);
					}
				} catch (error) {
					logWarning('server', `Failed to get next number from Keez, using fallback`, { tenantId, stackTrace: error instanceof Error ? error.stack : undefined });
				}

				// Fallback: use last synced number or start number
				let nextNum: string;
				if (settings.keezLastSyncedNumber) {
					const numericPart = extractInvoiceNumber(settings.keezLastSyncedNumber);
					nextNum = generateNextKeezInvoiceNumber(numericPart);
				} else if (settings.keezStartNumber) {
					nextNum = extractInvoiceNumber(settings.keezStartNumber);
				} else {
					nextNum = '1';
				}

				return generateKeezInvoiceNumber(keezSeries, nextNum);
			}
		}
	}

	// Check SmartBill integration
	if (settings.smartbillSeries) {
		const smartbillSeries = settings.smartbillSeries.trim();
		// If series is provided, only use SmartBill if it matches
		if (!series || smartbillSeries === series) {
			// Check if SmartBill integration is active
			const [smartbillIntegration] = await db
				.select()
				.from(table.smartbillIntegration)
				.where(
					and(
						eq(table.smartbillIntegration.tenantId, tenantId),
						eq(table.smartbillIntegration.isActive, true)
					)
				)
				.limit(1);

			if (smartbillIntegration && settings.smartbillStartNumber) {
				// Generate next number from last synced or start number
				let nextNum: string;
				if (settings.smartbillLastSyncedNumber) {
					nextNum = generateNextSmartBillInvoiceNumber(settings.smartbillLastSyncedNumber);
				} else {
					nextNum = settings.smartbillStartNumber;
				}

				// SmartBill format: "SERIA-NUMĂR"
				return `${smartbillSeries}-${nextNum}`;
			}
		}
	}

	return null;
}

/**
 * Calculate the next run date based on recurring type and interval
 */
export function calculateNextRunDate(
	currentDate: Date,
	recurringType: string,
	recurringInterval: number
): Date {
	const nextDate = new Date(currentDate);

	switch (recurringType) {
		case 'daily':
			nextDate.setDate(nextDate.getDate() + recurringInterval);
			break;
		case 'weekly':
			nextDate.setDate(nextDate.getDate() + recurringInterval * 7);
			break;
		case 'monthly':
			nextDate.setMonth(nextDate.getMonth() + recurringInterval);
			// Handle month-end edge cases (e.g., Jan 31 + 1 month = Feb 28/29)
			if (nextDate.getDate() !== currentDate.getDate()) {
				nextDate.setDate(0); // Go to last day of previous month
			}
			break;
		case 'yearly':
			nextDate.setFullYear(nextDate.getFullYear() + recurringInterval);
			// Handle leap year edge cases
			if (nextDate.getMonth() !== currentDate.getMonth()) {
				nextDate.setDate(0); // Go to last day of previous month
			}
			break;
		default:
			throw new Error(`Unknown recurring type: ${recurringType}`);
	}

	return nextDate;
}

/**
 * Generate an invoice from a recurring invoice template
 * This is used by the scheduler and can also be called manually
 */
export async function generateInvoiceFromRecurringTemplate(recurringInvoiceId: string) {
	// Get recurring invoice template
	const [recurringInvoice] = await db
		.select()
		.from(table.recurringInvoice)
		.where(eq(table.recurringInvoice.id, recurringInvoiceId))
		.limit(1);

	if (!recurringInvoice) {
		throw new Error('Recurring invoice not found');
	}

	if (!recurringInvoice.isActive) {
		throw new Error('Recurring invoice is not active');
	}

	const now = new Date();
	if (recurringInvoice.endDate && new Date(recurringInvoice.endDate) < now) {
		throw new Error('Recurring invoice has ended');
	}

	// Calculate issue date and due date
	const issueDate = new Date(now);
	issueDate.setDate(issueDate.getDate() + recurringInvoice.issueDateOffset);

	const dueDate = new Date(issueDate);
	dueDate.setDate(dueDate.getDate() + recurringInvoice.dueDateOffset);

	// Load line items from lineItemsJson field (preferred) or fallback to notes metadata (backward compatibility)
	let lineItems: Array<{
		description: string;
		quantity: number;
		rate: number;
		taxRate?: number;
		discountType?: string;
		discount?: number;
		note?: string;
		currency?: string;
		unitOfMeasure?: string;
		keezItemExternalId?: string;
		serviceId?: string;
	}> | null = null;

	// Parse invoice fields from notes
	let invoiceFields: {
		discountType?: string;
		discountValue?: number;
		taxApplicationType?: string;
		invoiceSeries?: string;
		invoiceCurrency?: string;
		paymentTerms?: string;
		paymentMethod?: string;
		exchangeRate?: string;
		vatOnCollection?: boolean;
		isCreditNote?: boolean;
	} = {};

	let userNotes = recurringInvoice.notes || '';

	// Try to load line items from lineItemsJson field first
	if (recurringInvoice.lineItemsJson) {
		try {
			const parsed = JSON.parse(recurringInvoice.lineItemsJson);
			if (!Array.isArray(parsed) || parsed.length === 0) {
				logWarning('server', `lineItemsJson is empty or not an array, will use fallback single item`, { tenantId: recurringInvoice.tenantId });
			} else {
				lineItems = parsed;
			}
		} catch (e) {
			logWarning('server', `Failed to parse lineItemsJson for template ${recurringInvoiceId}, will use fallback single item`, { tenantId: recurringInvoice.tenantId, stackTrace: e instanceof Error ? e.stack : undefined });
		}
	}

	// Parse invoice fields from notes (for backward compatibility and additional fields)
	if (recurringInvoice.notes) {
		// Try new format first (RECURRING_INVOICE_FIELDS)
		const fieldsMatch = recurringInvoice.notes.match(/<!-- RECURRING_INVOICE_FIELDS:(.+?) -->/);
		if (fieldsMatch) {
			try {
				invoiceFields = JSON.parse(fieldsMatch[1]);
				// Remove fields metadata from notes
				userNotes = recurringInvoice.notes
					.replace(/<!-- RECURRING_INVOICE_FIELDS:.+? -->/g, '')
					.trim();
			} catch (e) {
				// If parsing fails, try old format
			}
		}

		// Fallback to old format (RECURRING_INVOICE_METADATA) for backward compatibility
		if (!lineItems) {
			const metadataMatch = recurringInvoice.notes.match(
				/<!-- RECURRING_INVOICE_METADATA:(.+?) -->/
			);
			if (metadataMatch) {
				try {
					const metadata = JSON.parse(metadataMatch[1]);
					if (metadata.lineItems) {
						lineItems = metadata.lineItems;
					}
					if (metadata.invoiceFields) {
						invoiceFields = metadata.invoiceFields;
					}
					// Remove metadata from notes to get user notes only
					userNotes = recurringInvoice.notes
						.replace(/<!-- RECURRING_INVOICE_METADATA:.+? -->/g, '')
						.trim();
				} catch (e) {
					// If parsing fails, use the full notes
					if (!userNotes) {
						userNotes = recurringInvoice.notes;
					}
				}
			}
		}
	}

	// Get default tax rate from invoice settings
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, recurringInvoice.tenantId))
		.limit(1);

	const defaultTaxRatePercent = invoiceSettings?.defaultTaxRate ?? 19;
	const defaultTaxRateCents = defaultTaxRatePercent * 100;

	// Calculate amounts (use stored amount, but we'll recalculate from line items if available)
	let amount = recurringInvoice.amount;
	let taxRate = recurringInvoice.taxRate;
	let taxAmount = Math.round((amount * taxRate) / 10000);
	let totalAmount = amount + taxAmount;

	// If we have line items, fetch latest prices and recalculate amounts
	if (lineItems && lineItems.length > 0) {
		const taxApplicationType = invoiceFields.taxApplicationType || 'apply';

		// Fetch latest prices from services or Keez
		// Note: Rates from lineItemsJson are in currency units, need to convert to cents
		const updatedLineItems = await Promise.all(
			lineItems.map(async (item) => {
				// Convert stored rate to cents (stored rates are in currency units)
				let latestRate = Math.round(item.rate * 100);

				// Fetch from service if serviceId exists
				if (item.serviceId) {
					const [service] = await db
						.select()
						.from(table.service)
						.where(
							and(
								eq(table.service.id, item.serviceId),
								eq(table.service.tenantId, recurringInvoice.tenantId)
							)
						)
						.limit(1);

					if (service && service.price) {
						latestRate = service.price; // Already in cents
					}
				}
				// Fetch from Keez if keezItemExternalId exists
				else if (item.keezItemExternalId) {
					const [keezIntegration] = await db
						.select()
						.from(table.keezIntegration)
						.where(
							and(
								eq(table.keezIntegration.tenantId, recurringInvoice.tenantId),
								eq(table.keezIntegration.isActive, true)
							)
						)
						.limit(1);

					if (keezIntegration) {
						try {
							const secret = decrypt(recurringInvoice.tenantId, keezIntegration.secret);
							const keezClient = new KeezClient({
								clientEid: keezIntegration.clientEid,
								applicationId: keezIntegration.applicationId,
								secret
							});

							const keezItem = await keezClient.getItem(item.keezItemExternalId);
							if (keezItem && keezItem.lastPrice !== undefined) {
								latestRate = Math.round(keezItem.lastPrice * 100); // Convert to cents
							}
						} catch (error) {
							logWarning('server', `Failed to fetch Keez item ${item.keezItemExternalId}`, { tenantId: recurringInvoice.tenantId, stackTrace: error instanceof Error ? error.stack : undefined });
							// Use stored rate (already converted to cents above) as fallback
						}
					}
				}

				return {
					...item,
					rate: latestRate // Now in cents
				};
			})
		);

		// Recalculate totals with updated prices
		let subtotal = 0;
		let totalTax = 0;

		for (const item of updatedLineItems) {
			const itemRate = item.rate; // Already in cents
			let itemSubtotal = Math.round(itemRate * item.quantity);

			// Apply item-level discount if present
			if (item.discountType && item.discount !== undefined) {
				let itemDiscount = 0;
				if (item.discountType === 'percent') {
					itemDiscount = Math.round((itemSubtotal * item.discount) / 100);
				} else if (item.discountType === 'fixed') {
					itemDiscount = Math.round(item.discount * 100); // Convert to cents
				}
				itemSubtotal -= itemDiscount;
			}

			subtotal += itemSubtotal;

			// Only calculate tax if taxApplicationType is 'apply'
			if (taxApplicationType === 'apply') {
				const itemTaxRate = item.taxRate ? Math.round(item.taxRate * 100) : defaultTaxRateCents;
				const itemTax = Math.round((itemSubtotal * itemTaxRate) / 10000);
				totalTax += itemTax;
			}
		}

		// Apply invoice-level discount if present
		let discountAmount = 0;
		if (
			invoiceFields.discountType &&
			invoiceFields.discountType !== 'none' &&
			invoiceFields.discountValue !== undefined
		) {
			if (invoiceFields.discountType === 'percent') {
				discountAmount = Math.round((subtotal * invoiceFields.discountValue) / 100);
			} else if (invoiceFields.discountType === 'value') {
				discountAmount = Math.round(invoiceFields.discountValue * 100); // Convert to cents
			}
			subtotal -= discountAmount;
		}

		amount = subtotal;
		taxAmount = totalTax;
		totalAmount = amount + taxAmount;
		if (taxApplicationType === 'apply') {
			taxRate = updatedLineItems[0]?.taxRate
				? Math.round(updatedLineItems[0].taxRate * 100)
				: defaultTaxRateCents;
		} else {
			taxRate = 0;
		}

		// Update lineItems with updated prices for later use
		lineItems = updatedLineItems;
	}

	// Get invoice series from invoice fields (needed for invoice number generation)
	const invoiceSeriesFromMetadata = invoiceFields.invoiceSeries;

	// Generate invoice number using plugin settings (SmartBill/Keez)
	let invoiceNumber: string;
	if (invoiceSeriesFromMetadata) {
		// Use series from metadata to get next number from matching plugin
		const nextNumber = await getNextInvoiceNumberFromPlugin(
			recurringInvoice.tenantId,
			invoiceSeriesFromMetadata
		);
		if (nextNumber) {
			invoiceNumber = nextNumber;
		} else {
			// Fallback to generateInvoiceNumber if plugin doesn't match
			invoiceNumber = await generateInvoiceNumber(recurringInvoice.tenantId);
		}
	} else {
		// No series specified, use plugin-based generation (checks both SmartBill and Keez)
		const nextNumber = await getNextInvoiceNumberFromPlugin(recurringInvoice.tenantId);
		if (nextNumber) {
			invoiceNumber = nextNumber;
		} else {
			// Fallback to generateInvoiceNumber
			invoiceNumber = await generateInvoiceNumber(recurringInvoice.tenantId);
		}
	}
	const invoiceId = generateInvoiceId();

	// Create invoice
	const newInvoice = {
		id: invoiceId,
		tenantId: recurringInvoice.tenantId,
		clientId: recurringInvoice.clientId,
		projectId: recurringInvoice.projectId || null,
		serviceId: recurringInvoice.serviceId || null,
		invoiceNumber,
		status: 'draft' as const, // Created as draft; auto-send sets to 'sent' after email delivery
		amount,
		taxRate,
		taxAmount,
		totalAmount,
		currency: recurringInvoice.currency,
		issueDate,
		dueDate,
		notes: userNotes || null,
		invoiceSeries: invoiceFields.invoiceSeries || null,
		invoiceCurrency: invoiceFields.invoiceCurrency || null,
		paymentTerms: invoiceFields.paymentTerms || null,
		paymentMethod: invoiceFields.paymentMethod || null,
		exchangeRate: invoiceFields.exchangeRate || null,
		vatOnCollection: invoiceFields.vatOnCollection || false,
		isCreditNote: invoiceFields.isCreditNote || false,
		taxApplicationType: invoiceFields.taxApplicationType || 'apply',
		discountType: invoiceFields.discountType || null,
		discountValue: invoiceFields.discountValue
			? invoiceFields.discountType === 'percent'
				? Math.round(invoiceFields.discountValue * 100) // Store as basis points
				: Math.round(invoiceFields.discountValue * 100) // Convert to cents
			: null,
		createdByUserId: recurringInvoice.createdByUserId
	};

	// Wrap invoice + line items + recurring update in a transaction
	const previousLastRunDate = recurringInvoice.lastRunDate;
	const previousNextRunDate = recurringInvoice.nextRunDate;
	const nextRunDate = calculateNextRunDate(
		now,
		recurringInvoice.recurringType,
		recurringInvoice.recurringInterval
	);

	await db.transaction(async (tx) => {
		await tx.insert(table.invoice).values(newInvoice);

		// Create line items - always create at least one (required by SmartBill)
		if (lineItems && lineItems.length > 0) {
			const lineItemsToInsert = lineItems.map((item) => {
				const itemRate = item.rate;
				let itemSubtotal = Math.round(itemRate * item.quantity);

				let itemDiscountCents: number | null = null;
				if (item.discountType && item.discount !== undefined) {
					if (item.discountType === 'percent') {
						itemDiscountCents = Math.round((itemSubtotal * item.discount) / 100);
					} else if (item.discountType === 'fixed') {
						itemDiscountCents = Math.round(item.discount * 100);
					}
					if (itemDiscountCents) {
						itemSubtotal -= itemDiscountCents;
					}
				}

				return {
					id: generateInvoiceLineItemId(),
					invoiceId,
					serviceId: item.serviceId || null,
					description: item.description,
					quantity: item.quantity,
					rate: itemRate,
					amount: itemSubtotal,
					taxRate: item.taxRate ? Math.round(item.taxRate * 100) : null,
					discountType: item.discountType || null,
					discount: itemDiscountCents,
					note: item.note || null,
					currency: item.currency || null,
					unitOfMeasure: item.unitOfMeasure || null,
					keezItemExternalId: item.keezItemExternalId || null
				};
			});

			await tx.insert(table.invoiceLineItem).values(lineItemsToInsert);
		} else {
			const lineItemToInsert = {
				id: generateInvoiceLineItemId(),
				invoiceId,
				serviceId: recurringInvoice.serviceId || null,
				description: recurringInvoice.name || 'Recurring Invoice Item',
				quantity: 1,
				rate: amount,
				amount: amount,
				taxRate: taxRate > 0 ? taxRate : null,
				discountType: null,
				discount: null,
				note: null,
				currency: recurringInvoice.currency || null,
				unitOfMeasure: null,
				keezItemExternalId: null
			};

			await tx.insert(table.invoiceLineItem).values([lineItemToInsert]);
		}

		// Update recurring invoice: set lastRunDate and calculate nextRunDate
		await tx
			.update(table.recurringInvoice)
			.set({
				lastRunDate: now,
				nextRunDate,
				updatedAt: new Date()
			})
			.where(eq(table.recurringInvoice.id, recurringInvoiceId));
	});

	// Get the saved invoice for hooks
	const [savedInvoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	// Emit invoice.created hook (after database insert)
	// If hook fails, rollback by deleting the invoice and reverting recurring invoice update
	const hooks = getHooksManager();
	try {
		await hooks.emit({
			type: 'invoice.created',
			invoice: savedInvoice as any,
			tenantId: recurringInvoice.tenantId,
			userId: recurringInvoice.createdByUserId,
			isRecurring: true
		});
	} catch (error) {
		// Rollback: delete the invoice and revert recurring invoice update
		await db.delete(table.invoice).where(eq(table.invoice.id, invoiceId));
		await db
			.update(table.recurringInvoice)
			.set({
				lastRunDate: previousLastRunDate,
				nextRunDate: previousNextRunDate,
				updatedAt: new Date()
			})
			.where(eq(table.recurringInvoice.id, recurringInvoiceId));
		throw error;
	}

	return { success: true, invoiceId };
}
