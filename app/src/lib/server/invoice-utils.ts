import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getHooksManager } from './plugins/hooks';
import { generateKeezInvoiceNumber, extractInvoiceNumber } from '$lib/utils/invoice';
import { KeezClient } from './plugins/keez/client';
import { decrypt } from './plugins/keez/crypto';
import { generateNextInvoiceNumber } from './plugins/keez/mapper';

function generateInvoiceId() {
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
			return generateKeezInvoiceNumber(series, nextNumber);
		}
	} catch (error) {
		console.warn(`[Invoice] Failed to get next number from Keez, using fallback:`, error);
	}

	// Fallback: use last synced number or start number
	let nextNum: string;
	if (settings.keezLastSyncedNumber) {
		// Extract numeric part and increment
		const numericPart = extractInvoiceNumber(settings.keezLastSyncedNumber);
		nextNum = generateNextInvoiceNumber(numericPart);
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

	// Calculate amounts
	const amount = recurringInvoice.amount;
	const taxRate = recurringInvoice.taxRate;
	const taxAmount = Math.round((amount * taxRate) / 10000);
	const totalAmount = amount + taxAmount;

	// Generate invoice number (with Keez series if configured)
	const invoiceNumber = await generateInvoiceNumber(recurringInvoice.tenantId);
	const invoiceId = generateInvoiceId();

	// Create invoice
	const newInvoice = {
		id: invoiceId,
		tenantId: recurringInvoice.tenantId,
		clientId: recurringInvoice.clientId,
		projectId: recurringInvoice.projectId || null,
		serviceId: recurringInvoice.serviceId || null,
		invoiceNumber,
		status: 'sent' as const, // Automatically set to 'sent' as per plan
		amount,
		taxRate,
		taxAmount,
		totalAmount,
		currency: recurringInvoice.currency,
		issueDate,
		dueDate,
		notes: recurringInvoice.notes || null,
		createdByUserId: recurringInvoice.createdByUserId
	};

	await db.insert(table.invoice).values(newInvoice);

	// Emit invoice.created hook
	const hooks = getHooksManager();
	await hooks.emit({
		type: 'invoice.created',
		invoice: newInvoice as any,
		tenantId: recurringInvoice.tenantId,
		userId: recurringInvoice.createdByUserId
	});

	// Update recurring invoice: set lastRunDate and calculate nextRunDate
	const nextRunDate = calculateNextRunDate(
		new Date(issueDate),
		recurringInvoice.recurringType,
		recurringInvoice.recurringInterval
	);

	await db
		.update(table.recurringInvoice)
		.set({
			lastRunDate: now,
			nextRunDate,
			updatedAt: new Date()
		})
		.where(eq(table.recurringInvoice.id, recurringInvoiceId));

	return { success: true, invoiceId };
}
