/**
 * Transaction to Invoice Matching Engine
 * Automatically matches bank transactions to invoices
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, isNull, sql, inArray } from 'drizzle-orm';
import { markInvoiceAsPaid } from '$lib/remotes/invoices.remote';
import { encodeBase32LowerCase } from '@oslojs/encoding';

/**
 * Normalize IBAN for comparison (remove spaces, convert to uppercase)
 */
function normalizeIban(iban: string | null | undefined): string | null {
	if (!iban) return null;
	return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Extract invoice number from transaction description/reference
 */
function extractInvoiceNumber(text: string | null | undefined): string | null {
	if (!text) return null;

	// Try to find invoice number patterns
	// Pattern 1: INV-1234567890
	const invPattern = /INV-?(\d+)/i.exec(text);
	if (invPattern) {
		return invPattern[1];
	}

	// Pattern 2: Just numbers that look like invoice numbers (6+ digits)
	const numberPattern = /\b(\d{6,})\b/.exec(text);
	if (numberPattern) {
		return numberPattern[1];
	}

	return null;
}

/**
 * Match transaction by IBAN and amount
 */
async function matchByIbanAndAmount(
	tenantId: string,
	transaction: typeof table.bankTransaction.$inferSelect
): Promise<typeof table.invoice.$inferSelect | null> {
	if (!transaction.counterpartIban || transaction.amount <= 0) {
		return null; // Only match incoming transactions (positive amounts)
	}

	const normalizedCounterpartIban = normalizeIban(transaction.counterpartIban);
	if (!normalizedCounterpartIban) {
		return null;
	}

	// Find clients with matching IBAN
	const clients = await db
		.select()
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenantId),
				sql`REPLACE(UPPER(${table.client.iban}), ' ', '') = ${normalizedCounterpartIban}`
			)
		);

	if (clients.length === 0) {
		return null;
	}

	const clientIds = clients.map((c) => c.id);

	// Find invoices for these clients that match the amount
	// Amount should match within ±1 cent tolerance (for rounding differences)
	const amountTolerance = 1; // 1 cent

	const invoices = await db
		.select()
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				inArray(table.invoice.clientId, clientIds),
				or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'overdue')),
				sql`ABS(${table.invoice.totalAmount} - ${transaction.amount}) <= ${amountTolerance}`,
				sql`${table.invoice.issueDate} <= ${transaction.date}`
			)
		)
		.orderBy(sql`ABS(${table.invoice.totalAmount} - ${transaction.amount}) ASC`)
		.limit(1);

	if (invoices.length > 0) {
		return invoices[0];
	}

	return null;
}

/**
 * Match transaction by invoice number in description/reference
 */
async function matchByInvoiceNumber(
	tenantId: string,
	transaction: typeof table.bankTransaction.$inferSelect
): Promise<typeof table.invoice.$inferSelect | null> {
	if (transaction.amount <= 0) {
		return null; // Only match incoming transactions
	}

	// Extract invoice number from description or reference
	const invoiceNumber = extractInvoiceNumber(transaction.description) || extractInvoiceNumber(transaction.reference);
	if (!invoiceNumber) {
		return null;
	}

	// Try to match by invoice number
	// Invoice numbers are stored as "INV-{timestamp}" or similar format
	// We need to match the numeric part
	const invoices = await db
		.select()
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'overdue')),
				sql`${table.invoice.invoiceNumber} LIKE ${`%${invoiceNumber}%`}`,
				// Amount should match within tolerance
				sql`ABS(${table.invoice.totalAmount} - ${transaction.amount}) <= 1`,
				sql`${table.invoice.issueDate} <= ${transaction.date}`
			)
		)
		.limit(1);

	if (invoices.length > 0) {
		return invoices[0];
	}

	return null;
}

/**
 * Match a single transaction to invoices
 */
export async function matchTransactionToInvoices(
	tenantId: string,
	transaction: typeof table.bankTransaction.$inferSelect
): Promise<typeof table.invoice.$inferSelect | null> {
	// Skip if already matched
	if (transaction.matchedInvoiceId) {
		return null;
	}

	// Only match incoming transactions (positive amounts)
	if (transaction.amount <= 0) {
		return null;
	}

	// Try IBAN + amount match first (most reliable)
	let matchedInvoice = await matchByIbanAndAmount(tenantId, transaction);
	let matchingMethod = 'iban-amount';

	// Fallback to invoice number match
	if (!matchedInvoice) {
		matchedInvoice = await matchByInvoiceNumber(tenantId, transaction);
		matchingMethod = 'invoice-number';
	}

	return matchedInvoice;
}

/**
 * Automatically match unmatched transactions to invoices
 */
export async function autoMatchTransactions(tenantId: string): Promise<number> {
	let matchedCount = 0;

	// Get all unmatched incoming transactions
	const unmatchedTransactions = await db
		.select()
		.from(table.bankTransaction)
		.where(
			and(
				eq(table.bankTransaction.tenantId, tenantId),
				isNull(table.bankTransaction.matchedInvoiceId),
				sql`${table.bankTransaction.amount} > 0` // Only incoming
			)
		);

	for (const transaction of unmatchedTransactions) {
		const matchedInvoice = await matchTransactionToInvoices(tenantId, transaction);

		if (matchedInvoice) {
			// Update transaction
			await db
				.update(table.bankTransaction)
				.set({
					matchedInvoiceId: matchedInvoice.id,
					matchingMethod: matchedInvoice ? 'iban-amount' : 'invoice-number',
					updatedAt: new Date()
				})
				.where(eq(table.bankTransaction.id, transaction.id));

			// Create match record (we'll need the user ID, but for auto-matching we can use system)
			const matchId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.transactionInvoiceMatch).values({
				id: matchId,
				tenantId,
				transactionId: transaction.id,
				invoiceId: matchedInvoice.id,
				matchingMethod: matchedInvoice ? 'iban-amount' : 'invoice-number',
				matchedByUserId: null // System match
			});

			// Mark invoice as paid
			if (matchedInvoice.status !== 'paid') {
				await db
					.update(table.invoice)
					.set({
						status: 'paid',
						paidDate: transaction.date,
						updatedAt: new Date()
					})
					.where(eq(table.invoice.id, matchedInvoice.id));
			}

			matchedCount++;
		}
	}

	return matchedCount;
}

/**
 * Validate if a transaction-invoice match is valid
 */
export function validateMatch(
	transaction: typeof table.bankTransaction.$inferSelect,
	invoice: typeof table.invoice.$inferSelect
): { valid: boolean; confidence: 'high' | 'medium' | 'low'; reasons: string[] } {
	const reasons: string[] = [];
	let confidence: 'high' | 'medium' | 'low' = 'low';

	// Check amount match (within 1 cent tolerance)
	const amountDiff = Math.abs((invoice.totalAmount || 0) - transaction.amount);
	if (amountDiff <= 1) {
		reasons.push('Amount matches');
		confidence = 'high';
	} else if (amountDiff <= 100) {
		// Within 1 RON/currency unit
		reasons.push('Amount is close');
		confidence = 'medium';
	} else {
		reasons.push('Amount mismatch');
	}

	// Check date (transaction should be after invoice issue date)
	if (invoice.issueDate && transaction.date >= invoice.issueDate) {
		reasons.push('Date is valid');
		if (confidence === 'low') confidence = 'medium';
	} else {
		reasons.push('Date mismatch (transaction before invoice)');
		confidence = 'low';
	}

	// Check status
	if (invoice.status === 'paid') {
		reasons.push('Invoice already paid');
		confidence = 'low';
	}

	const valid = confidence !== 'low' && amountDiff <= 100;

	return { valid, confidence, reasons };
}
