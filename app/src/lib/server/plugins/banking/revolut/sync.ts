/**
 * Internal Revolut transaction sync function for scheduled tasks
 * This function can be called without request event context
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, isNull, sql, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { RevolutClient } from './client';
import { getRevolutConfigForClient } from './config';
import { encryptToken, decryptToken } from '../shared/crypto';

function generateTransactionId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateMatchId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

// Helper function to normalize IBAN
function normalizeIban(iban: string | null | undefined): string | null {
	if (!iban) return null;
	return iban.replace(/\s/g, '').toUpperCase();
}

// Helper function to extract description pattern (remove amounts, dates, etc.)
function extractDescriptionPattern(description: string | null | undefined): string | null {
	if (!description) return null;
	// Remove common patterns: amounts, dates, transaction IDs
	let pattern = description
		.replace(/\d+[.,]\d{2}/g, '') // Remove amounts like 123.45
		.replace(/\d{4}-\d{2}-\d{2}/g, '') // Remove dates
		.replace(/\d{2}\/\d{2}\/\d{4}/g, '') // Remove dates
		.replace(
			/[A-Z]{2}\d{2}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{4}[\s-]?[A-Z0-9]{0,30}/gi,
			''
		) // Remove IBANs
		.replace(/\s+/g, ' ')
		.trim();
	return pattern.length >= 3 ? pattern : null;
}

// Helper function to check if two strings match (fuzzy matching)
function fuzzyMatch(str1: string | null | undefined, str2: string | null | undefined): boolean {
	if (!str1 || !str2) return false;
	const s1 = str1.toLowerCase().trim();
	const s2 = str2.toLowerCase().trim();

	// Exact match
	if (s1 === s2) return true;

	// Contains match
	if (s1.includes(s2) || s2.includes(s1)) return true;

	// Word-based match (if both have at least 3 characters)
	if (s1.length >= 3 && s2.length >= 3) {
		const words1 = s1.split(/\s+/).filter((w) => w.length >= 3);
		const words2 = s2.split(/\s+/).filter((w) => w.length >= 3);

		if (words1.length === 0 || words2.length === 0) return false;

		// Check if majority of words match
		const matchingWords = words1.filter((w1) =>
			words2.some((w2) => w1.includes(w2) || w2.includes(w1))
		);
		return matchingWords.length >= Math.min(words1.length, words2.length) * 0.6; // 60% match threshold
	}

	return false;
}

// Find matching rule for a transaction
async function findMatchingRule(
	transaction: typeof table.bankTransaction.$inferSelect,
	tenantId: string,
	matchType: 'supplier' | 'client' | 'user'
): Promise<typeof table.transactionMatchRule.$inferSelect | null> {
	const normalizedIban = normalizeIban(transaction.counterpartIban);
	const descriptionPattern = extractDescriptionPattern(transaction.description);
	const referencePattern = extractDescriptionPattern(transaction.reference);

	// Get all rules for this match type
	const rules = await db
		.select()
		.from(table.transactionMatchRule)
		.where(
			and(
				eq(table.transactionMatchRule.tenantId, tenantId),
				eq(table.transactionMatchRule.matchType, matchType)
			)
		);

	if (rules.length === 0) return null;

	// Score each rule
	const scoredRules = rules.map((rule) => {
		let score = 0;
		let matched = false;

		// IBAN match (highest priority)
		if (normalizedIban && rule.counterpartIban) {
			if (normalizeIban(rule.counterpartIban) === normalizedIban) {
				score += 100;
				matched = true;
			}
		}

		// Counterpart name match (high priority)
		if (transaction.counterpartName && rule.counterpartName) {
			if (fuzzyMatch(transaction.counterpartName, rule.counterpartName)) {
				score += 50;
				matched = true;
			}
		}

		// Description pattern match (medium priority)
		if (descriptionPattern && rule.descriptionPattern) {
			if (fuzzyMatch(descriptionPattern, rule.descriptionPattern)) {
				score += 25;
				matched = true;
			}
		}

		// Reference pattern match (lower priority)
		if (referencePattern && rule.referencePattern) {
			if (fuzzyMatch(referencePattern, rule.referencePattern)) {
				score += 10;
				matched = true;
			}
		}

		// Boost score by matchCount (rules that matched more are preferred)
		score += Math.min(rule.matchCount, 20); // Cap at 20 to not overpower other factors

		// Boost score if rule was created manually
		if (rule.createdByUserId) {
			score += 5;
		}

		return { rule, score, matched };
	});

	// Filter to only matched rules and sort by score
	const matchedRules = scoredRules.filter((r) => r.matched).sort((a, b) => b.score - a.score);

	if (matchedRules.length === 0) return null;

	return matchedRules[0].rule;
}

// Find expense matching rule for a transaction
async function findExpenseMatchingRule(
	transaction: typeof table.bankTransaction.$inferSelect,
	tenantId: string
): Promise<typeof table.transactionMatchRule.$inferSelect | null> {
	const normalizedIban = normalizeIban(transaction.counterpartIban);
	const descriptionPattern = extractDescriptionPattern(transaction.description);
	const referencePattern = extractDescriptionPattern(transaction.reference);

	// Get all expense matching rules for this tenant
	const rules = await db
		.select()
		.from(table.transactionMatchRule)
		.where(
			and(
				eq(table.transactionMatchRule.tenantId, tenantId),
				eq(table.transactionMatchRule.matchType, 'expense')
			)
		);

	if (rules.length === 0) return null;

	// Score each rule
	const scoredRules = rules.map((rule) => {
		let score = 0;
		let matched = false;

		// IBAN match (highest priority)
		if (normalizedIban && rule.counterpartIban) {
			if (normalizeIban(rule.counterpartIban) === normalizedIban) {
				score += 100;
				matched = true;
			}
		}

		// Counterpart name match (high priority)
		if (transaction.counterpartName && rule.counterpartName) {
			if (fuzzyMatch(transaction.counterpartName, rule.counterpartName)) {
				score += 50;
				matched = true;
			}
		}

		// Description pattern match (medium priority)
		if (descriptionPattern && rule.descriptionPattern) {
			if (fuzzyMatch(descriptionPattern, rule.descriptionPattern)) {
				score += 25;
				matched = true;
			}
		}

		// Reference pattern match (lower priority)
		if (referencePattern && rule.referencePattern) {
			if (fuzzyMatch(referencePattern, rule.referencePattern)) {
				score += 10;
				matched = true;
			}
		}

		// Boost score by matchCount
		score += Math.min(rule.matchCount, 20);

		return { rule, score, matched };
	});

	// Filter to only matched rules and sort by score
	const matchedRules = scoredRules.filter((r) => r.matched).sort((a, b) => b.score - a.score);

	if (matchedRules.length === 0) return null;

	return matchedRules[0].rule;
}

/**
 * Sync Revolut transactions for a bank account (internal function for scheduled tasks)
 * @param tenantId - Tenant ID
 * @param bankAccountId - Bank account ID
 * @param days - Number of days to look back
 */
export async function syncRevolutTransactionsForAccount(
	tenantId: string,
	bankAccountId: string,
	days: number = 2
): Promise<{
	success: boolean;
	transactionsSynced: number;
}> {
	try {
		// Get bank account
		const [account] = await db
			.select()
			.from(table.bankAccount)
			.where(
				and(
					eq(table.bankAccount.id, bankAccountId),
					eq(table.bankAccount.tenantId, tenantId),
					eq(table.bankAccount.bankName, 'revolut')
				)
			)
			.limit(1);

		if (!account) {
			throw new Error('Revolut bank account not found');
		}

		if (!account.isActive) {
			throw new Error('Bank account is not active');
		}

		// Decrypt tokens
		let accessToken: string;
		let refreshToken: string;

		try {
			accessToken = decryptToken(tenantId, account.accessToken);
			refreshToken = decryptToken(tenantId, account.refreshToken);
		} catch (error) {
			throw new Error('Failed to decrypt tokens');
		}

		// Get Revolut client config
		const revolutConfig = await getRevolutConfigForClient(tenantId);
		if (!revolutConfig) {
			throw new Error(
				'Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.'
			);
		}

		const client = new RevolutClient(revolutConfig);

		// Check if token is expired and refresh if needed
		if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
			if (!refreshToken) {
				throw new Error('Refresh token is missing. Please reconnect the bank account.');
			}

			const tokens = await client.refreshTokens(refreshToken);

			if (!tokens.accessToken || !tokens.refreshToken) {
				throw new Error('Failed to refresh tokens: missing access or refresh token in response');
			}

			accessToken = tokens.accessToken;

			// Update tokens in database
			await db
				.update(table.bankAccount)
				.set({
					accessToken: encryptToken(tenantId, tokens.accessToken),
					refreshToken: encryptToken(tenantId, tokens.refreshToken),
					tokenExpiresAt: tokens.expiresAt,
					updatedAt: new Date()
				})
				.where(eq(table.bankAccount.id, bankAccountId));
		}

		// Validate access token before using
		if (!accessToken) {
			throw new Error('Access token is missing. Please reconnect the bank account.');
		}

		// Calculate date range for last N days
		const toDate = new Date();
		const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

		// Get transactions from Revolut
		const transactions = await client.getTransactions(accessToken, account.accountId, fromDate, toDate);

		// Store transactions
		const transactionIds: string[] = [];

		for (const txn of transactions) {
			// Check if transaction already exists
			const [existing] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.bankAccountId, bankAccountId),
						eq(table.bankTransaction.transactionId, txn.transactionId)
					)
				)
				.limit(1);

			if (!existing) {
				const transactionDbId = generateTransactionId();

				await db.insert(table.bankTransaction).values({
					id: transactionDbId,
					tenantId: tenantId,
					bankAccountId: bankAccountId,
					transactionId: txn.transactionId,
					amount: txn.amount,
					currency: txn.currency,
					date: txn.date,
					description: txn.description || null,
					reference: txn.reference || null,
					counterpartIban: txn.counterpartIban || null,
					counterpartName: txn.counterpartName || null,
					category: txn.category || null,
					isExpense: txn.amount < 0 // Negative amounts are expenses (outgoing)
				});

				transactionIds.push(transactionDbId);

				// Fetch the inserted transaction for matching
				const [newTransaction] = await db
					.select()
					.from(table.bankTransaction)
					.where(eq(table.bankTransaction.id, transactionDbId))
					.limit(1);

				if (!newTransaction) continue;

				// Handle negative transactions (expenses)
				if (txn.amount < 0) {
					const transactionAmount = Math.abs(txn.amount); // Convert to positive (in cents)

					// Find existing unpaid expenses with exact amount and currency match
					const matchingExpenses = await db
						.select()
						.from(table.expense)
						.where(
							and(
								eq(table.expense.tenantId, tenantId),
								eq(table.expense.amount, transactionAmount),
								eq(table.expense.currency, txn.currency), // Also match currency
								isNull(table.expense.bankTransactionId) // Only unpaid expenses
							)
						);

					if (matchingExpenses.length === 1) {
						// Exactly one match - link transaction to the matched expense
						const matchedExpense = matchingExpenses[0];

						// Link transaction to expense
						await db
							.update(table.bankTransaction)
							.set({
								expenseId: matchedExpense.id,
								updatedAt: new Date()
							})
							.where(eq(table.bankTransaction.id, transactionDbId));

						// Update expense - link transaction and mark as paid
						await db
							.update(table.expense)
							.set({
								bankTransactionId: transactionDbId,
								isPaid: true,
								updatedAt: new Date()
							})
							.where(eq(table.expense.id, matchedExpense.id));

						// Auto-link expense to supplier using matching rules
						const matchingRule = await findMatchingRule(
							newTransaction,
							tenantId,
							'supplier'
						);
						if (matchingRule && matchingRule.supplierId) {
							await db
								.update(table.expense)
								.set({
									supplierId: matchingRule.supplierId,
									updatedAt: new Date()
								})
								.where(eq(table.expense.id, matchedExpense.id));

							// Increment match count and update last matched timestamp
							await db
								.update(table.transactionMatchRule)
								.set({
									matchCount: sql`${table.transactionMatchRule.matchCount} + 1`,
									lastMatchedAt: new Date(),
									updatedAt: new Date()
								})
								.where(eq(table.transactionMatchRule.id, matchingRule.id));
						}
					} else if (matchingExpenses.length > 1) {
						// Multiple expenses with same amount - try to use matching rules
						const matchingRule = await findExpenseMatchingRule(newTransaction, tenantId);
						if (matchingRule && matchingRule.expenseId) {
							// Check if the matched expense is in our list and still unpaid
							const matchedExpense = matchingExpenses.find(
								(e) => e.id === matchingRule.expenseId && !e.bankTransactionId
							);
							if (matchedExpense) {
								// Link to the expense identified by matching rule
								await db
									.update(table.bankTransaction)
									.set({
										expenseId: matchedExpense.id,
										updatedAt: new Date()
									})
									.where(eq(table.bankTransaction.id, transactionDbId));

								// Update expense - link transaction and mark as paid
								await db
									.update(table.expense)
									.set({
										bankTransactionId: transactionDbId,
										isPaid: true,
										updatedAt: new Date()
									})
									.where(eq(table.expense.id, matchedExpense.id));

								// Update matching rule match count
								await db
									.update(table.transactionMatchRule)
									.set({
										matchCount: sql`${table.transactionMatchRule.matchCount} + 1`,
										lastMatchedAt: new Date(),
										updatedAt: new Date()
									})
									.where(eq(table.transactionMatchRule.id, matchingRule.id));

								// Auto-link expense to supplier using matching rules
								const supplierMatchingRule = await findMatchingRule(
									newTransaction,
									tenantId,
									'supplier'
								);
								if (supplierMatchingRule && supplierMatchingRule.supplierId) {
									await db
										.update(table.expense)
										.set({
											supplierId: supplierMatchingRule.supplierId,
											updatedAt: new Date()
										})
										.where(eq(table.expense.id, matchedExpense.id));

									// Increment match count and update last matched timestamp
									await db
										.update(table.transactionMatchRule)
										.set({
											matchCount: sql`${table.transactionMatchRule.matchCount} + 1`,
											lastMatchedAt: new Date(),
											updatedAt: new Date()
										})
										.where(eq(table.transactionMatchRule.id, supplierMatchingRule.id));
								}
							}
						}
					}
				} else if (newTransaction) {
					// For incoming transactions, try to match to client using matching rules
					const matchingRule = await findMatchingRule(newTransaction, tenantId, 'client');
					if (matchingRule && matchingRule.clientId) {
						// Try to match to an invoice for this client
						const invoices = await db
							.select()
							.from(table.invoice)
							.where(
								and(
									eq(table.invoice.tenantId, tenantId),
									eq(table.invoice.clientId, matchingRule.clientId),
									or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'overdue')),
									sql`ABS(${table.invoice.totalAmount} - ${txn.amount}) <= 1`, // Amount match within 1 cent
									sql`${table.invoice.issueDate} <= ${txn.date}`
								)
							)
							.orderBy(sql`ABS(${table.invoice.totalAmount} - ${txn.amount}) ASC`)
							.limit(1);

						if (invoices.length > 0) {
							const invoice = invoices[0];
							// Update transaction
							await db
								.update(table.bankTransaction)
								.set({
									matchedInvoiceId: invoice.id,
									matchingMethod: 'rule-based',
									updatedAt: new Date()
								})
								.where(eq(table.bankTransaction.id, transactionDbId));

							// Create match record
							const matchId = generateMatchId();
							await db.insert(table.transactionInvoiceMatch).values({
								id: matchId,
								tenantId: tenantId,
								transactionId: transactionDbId,
								invoiceId: invoice.id,
								matchingMethod: 'rule-based',
								matchedByUserId: null // System match
							});

							// Mark invoice as paid
							if (invoice.status !== 'paid') {
								await db
									.update(table.invoice)
									.set({
										status: 'paid',
										paidDate: txn.date,
										updatedAt: new Date()
									})
									.where(eq(table.invoice.id, invoice.id));
							}
						}

						// Increment match count and update last matched timestamp
						await db
							.update(table.transactionMatchRule)
							.set({
								matchCount: sql`${table.transactionMatchRule.matchCount} + 1`,
								lastMatchedAt: new Date(),
								updatedAt: new Date()
							})
							.where(eq(table.transactionMatchRule.id, matchingRule.id));
					}
				}
			}
		}

		// Update last synced timestamp
		await db
			.update(table.bankAccount)
			.set({
				lastSyncedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.bankAccount.id, bankAccountId));

		return { success: true, transactionsSynced: transactionIds.length };
	} catch (error) {
		console.error(
			`[Revolut] Failed to sync transactions for account ${bankAccountId}:`,
			error
		);
		throw error;
	}
}
