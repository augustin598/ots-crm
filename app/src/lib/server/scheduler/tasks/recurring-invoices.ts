import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { generateInvoiceFromRecurringTemplate } from '../../invoice-utils';

/**
 * Process recurring invoices - finds active recurring invoices that are due
 * and generates invoices for them
 */
export async function processRecurringInvoices(params: Record<string, any> = {}) {
	try {
		const now = new Date();

		// Find all active recurring invoices where nextRunDate <= now
		// and (endDate is null or endDate >= now)
		const conditions = [
			eq(table.recurringInvoice.isActive, true),
			lte(table.recurringInvoice.nextRunDate, now)
		];

		const recurringInvoices = await db
			.select()
			.from(table.recurringInvoice)
			.where(and(...conditions));

		// Filter out invoices that have ended
		const activeRecurringInvoices = recurringInvoices.filter((ri) => {
			if (!ri.endDate) return true;
			return new Date(ri.endDate) >= now;
		});

		let invoicesGenerated = 0;
		const errors: Array<{ id: string; error: string }> = [];

		// Generate invoice for each recurring invoice
		for (const recurringInvoice of activeRecurringInvoices) {
			try {
				await generateInvoiceFromRecurringTemplate(recurringInvoice.id);
				invoicesGenerated++;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(
					`Error generating invoice for recurring invoice ${recurringInvoice.id}:`,
					errorMessage
				);
				errors.push({ id: recurringInvoice.id, error: errorMessage });
			}
		}

		console.log(`Recurring invoices processed: ${invoicesGenerated} invoices generated`);
		if (errors.length > 0) {
			console.error(`Recurring invoice errors: ${errors.length}`, errors);
		}

		return {
			success: true,
			invoicesGenerated,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		console.error('Process recurring invoices error:', error);
		return {
			success: false,
			invoicesGenerated: 0,
			error: 'Failed to process recurring invoices'
		};
	}
}
