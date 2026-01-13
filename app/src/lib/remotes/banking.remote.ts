import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, gte, lte, or, isNull, isNotNull, sql, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { BankManager } from '$lib/server/plugins/banking/shared/manager';
import type { BankName } from '$lib/server/plugins/banking/shared/types';
import { encryptToken, decryptToken } from '$lib/server/plugins/banking/shared/crypto';
import { redirect } from '@sveltejs/kit';
import { RevolutClient } from '$lib/server/plugins/banking/revolut/client';
import { getRevolutConfigForClient } from '$lib/server/plugins/banking/revolut/config';
import { dev } from '$app/environment';
import * as storage from '$lib/server/storage';

function generateBankAccountId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateTransactionId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateExpenseId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateMatchId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateMatchRuleId() {
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

// Create or update a matching rule from a transaction
async function createMatchRuleFromTransaction(
	transaction: typeof table.bankTransaction.$inferSelect,
	tenantId: string,
	matchType: 'supplier' | 'client' | 'user',
	supplierId?: string | null,
	clientId?: string | null,
	userId?: string | null,
	userIban?: string | null
): Promise<void> {
	if (matchType === 'supplier' && !supplierId) return;
	if (matchType === 'client' && !clientId) return;
	if (matchType === 'user' && !userId) return;

	const normalizedIban = normalizeIban(transaction.counterpartIban);
	const descriptionPattern = extractDescriptionPattern(transaction.description);
	const referencePattern = extractDescriptionPattern(transaction.reference);

	// Check if a similar rule already exists
	let matchCondition: any;
	if (matchType === 'supplier') {
		matchCondition = eq(table.transactionMatchRule.supplierId, supplierId!);
	} else if (matchType === 'client') {
		matchCondition = eq(table.transactionMatchRule.clientId, clientId!);
	} else {
		matchCondition = eq(table.transactionMatchRule.userId, userId!);
	}

	const existingRules = await db
		.select()
		.from(table.transactionMatchRule)
		.where(
			and(
				eq(table.transactionMatchRule.tenantId, tenantId),
				eq(table.transactionMatchRule.matchType, matchType),
				matchCondition
			)
		);

	// Try to find an existing rule that matches
	let existingRule = existingRules.find((rule) => {
		// IBAN match (use counterpartIban field for all match types)
		if (normalizedIban && rule.counterpartIban) {
			if (normalizeIban(rule.counterpartIban) === normalizedIban) return true;
		}
		// Counterpart name match
		if (transaction.counterpartName && rule.counterpartName) {
			if (fuzzyMatch(transaction.counterpartName, rule.counterpartName)) return true;
		}
		// Description pattern match
		if (descriptionPattern && rule.descriptionPattern) {
			if (fuzzyMatch(descriptionPattern, rule.descriptionPattern)) return true;
		}
		return false;
	});

	if (existingRule) {
		// Update existing rule - merge criteria
		const updateData: any = {
			updatedAt: new Date()
		};

		if (normalizedIban && !existingRule.counterpartIban) {
			// Store IBAN in counterpartIban field (works for all match types)
			updateData.counterpartIban = normalizedIban;
		}
		if (transaction.counterpartName && !existingRule.counterpartName) {
			updateData.counterpartName = transaction.counterpartName;
		}
		if (descriptionPattern && !existingRule.descriptionPattern) {
			updateData.descriptionPattern = descriptionPattern;
		}
		if (referencePattern && !existingRule.referencePattern) {
			updateData.referencePattern = referencePattern;
		}

		await db
			.update(table.transactionMatchRule)
			.set(updateData)
			.where(eq(table.transactionMatchRule.id, existingRule.id));
	} else {
		// Create new rule
		const ruleId = generateMatchRuleId();
		await db.insert(table.transactionMatchRule).values({
			id: ruleId,
			tenantId,
			matchType,
			supplierId: matchType === 'supplier' ? supplierId! : null,
			clientId: matchType === 'client' ? clientId! : null,
			userId: matchType === 'user' ? userId! : null,
			counterpartIban: normalizedIban, // Store IBAN here for user matching (user's IBAN)
			counterpartName: transaction.counterpartName || null,
			descriptionPattern,
			referencePattern,
			matchCount: 0,
			createdByUserId: userId || null,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}
}

// Find matching rule for a transaction
async function findMatchingRule(
	transaction: typeof table.bankTransaction.$inferSelect,
	tenantId: string,
	matchType: 'supplier' | 'client' | 'user',
	userIban?: string | null
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

// Connection Management

export const getBankAccounts = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const accounts = await db
		.select()
		.from(table.bankAccount)
		.where(eq(table.bankAccount.tenantId, event.locals.tenant.id));

	// Don't return encrypted tokens in the response
	return accounts.map((acc) => ({
		...acc,
		accessToken: undefined,
		refreshToken: undefined
	}));
});

export const getBankConnectionUrl = query(v.pipe(v.string(), v.minLength(1)), async (bankName) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	if (!BankManager.isSupported(bankName)) {
		throw new Error(`Unsupported bank: ${bankName}`);
	}

	// Handle Revolut specially - load config from database
	let client;
	if (bankName === 'revolut') {
		const revolutConfig = await getRevolutConfigForClient(event.locals.tenant.id);
		if (!revolutConfig) {
			throw new Error(
				'Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.'
			);
		}
		client = new RevolutClient(revolutConfig);
	} else {
		client = BankManager.getClient(bankName as BankName);
	}

	const state = crypto.randomUUID();
	const origin = dev ? event.url.origin : event.url.origin.replace(/^http:/, 'https:');
	const redirectUri = `${origin}/${event.locals.tenant?.slug}/settings/banking/callback/${bankName}`;

	const authUrl = client.getAuthorizationUrl(state, redirectUri);

	// Store state in session or database for validation (simplified - use session in production)
	return { authUrl, state };
});

export const connectBankAccount = command(
	v.object({
		bankName: v.string(),
		authorizationCode: v.string(),
		state: v.optional(v.string()) // For CSRF protection
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		if (!BankManager.isSupported(data.bankName)) {
			throw new Error(`Unsupported bank: ${data.bankName}`);
		}

		// Handle Revolut specially - load config from database
		let client;
		if (data.bankName === 'revolut') {
			const revolutConfig = await getRevolutConfigForClient(event.locals.tenant.id);
			if (!revolutConfig) {
				throw new Error(
					'Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.'
				);
			}
			client = new RevolutClient(revolutConfig);
		} else {
			client = BankManager.getClient(data.bankName as BankName);
		}

		const origin = dev ? event.url.origin : event.url.origin.replace(/^http:/, 'https:');
		const redirectUri = `${origin}/${event.locals.tenant?.slug}/settings/banking/callback/${data.bankName}`;

		// Exchange code for tokens
		const tokens = await client.exchangeCodeForTokens(data.authorizationCode, redirectUri);

		// Get accounts from the bank
		const accounts = await client.getAccounts(tokens.accessToken);

		if (accounts.length === 0) {
			throw new Error('No accounts found for this connection');
		}

		// Store each account (banks can have multiple accounts)
		const accountIds: string[] = [];

		for (const accountInfo of accounts) {
			const accountId = generateBankAccountId();

			await db.insert(table.bankAccount).values({
				id: accountId,
				tenantId: event.locals.tenant.id,
				bankName: data.bankName,
				accountId: accountInfo.accountId,
				iban: accountInfo.iban,
				accountName: accountInfo.accountName || null,
				currency: accountInfo.currency,
				accessToken: encryptToken(event.locals.tenant.id, tokens.accessToken),
				refreshToken: encryptToken(event.locals.tenant.id, tokens.refreshToken),
				tokenExpiresAt: tokens.expiresAt,
				isActive: true
			});

			accountIds.push(accountId);
		}

		return { success: true, accountIds };
	}
);

export const syncBankAccounts = command(
	v.object({
		bankName: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const { bankName } = data;
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		if (!BankManager.isSupported(bankName)) {
			throw new Error(`Unsupported bank: ${bankName}`);
		}

		// Get all existing accounts for this bank
		const existingAccounts = await db
			.select()
			.from(table.bankAccount)
			.where(
				and(
					eq(table.bankAccount.bankName, bankName),
					eq(table.bankAccount.tenantId, event.locals.tenant.id)
				)
			);

		if (existingAccounts.length === 0) {
			throw new Error('No accounts found for this bank. Please connect the bank first.');
		}

		// Use the first account's tokens (they should all be the same)
		const firstAccount = existingAccounts[0];

		// Decrypt tokens
		let accessToken: string;
		let refreshToken: string;

		try {
			accessToken = decryptToken(event.locals.tenant.id, firstAccount.accessToken);
			refreshToken = decryptToken(event.locals.tenant.id, firstAccount.refreshToken);
		} catch (error) {
			throw new Error('Failed to decrypt tokens');
		}

		// Get client (handle Revolut specially)
		let client;
		if (bankName === 'revolut') {
			const revolutConfig = await getRevolutConfigForClient(event.locals.tenant.id);
			if (!revolutConfig) {
				throw new Error(
					'Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.'
				);
			}
			client = new RevolutClient(revolutConfig);
		} else {
			client = BankManager.getClient(bankName as BankName);
		}

		// Check if token is expired and refresh if needed
		let tokenExpiresAt = firstAccount.tokenExpiresAt;
		if (firstAccount.tokenExpiresAt && firstAccount.tokenExpiresAt.getTime() < Date.now()) {
			if (!refreshToken) {
				throw new Error('Refresh token is missing. Please reconnect the bank account.');
			}

			const tokens = await client.refreshTokens(refreshToken);

			if (!tokens.accessToken || !tokens.refreshToken) {
				throw new Error('Failed to refresh tokens: missing access or refresh token in response');
			}

			accessToken = tokens.accessToken;
			refreshToken = tokens.refreshToken;
			tokenExpiresAt = tokens.expiresAt;
		}

		// Validate tokens before using
		if (!accessToken || !refreshToken) {
			throw new Error(
				'Access token or refresh token is missing. Please reconnect the bank account.'
			);
		}

		// Fetch accounts from the bank
		const bankAccounts = await client.getAccounts(accessToken);

		if (bankAccounts.length === 0) {
			throw new Error('No accounts found from bank');
		}

		// Create a map of existing accounts by bank accountId
		const existingAccountMap = new Map(existingAccounts.map((acc) => [acc.accountId, acc]));

		const updatedAccountIds: string[] = [];
		const createdAccountIds: string[] = [];

		// Encrypt tokens (use updated tokens if they were refreshed)
		const encryptedAccessToken = encryptToken(event.locals.tenant.id, accessToken);
		const encryptedRefreshToken = encryptToken(event.locals.tenant.id, refreshToken);

		// Update or create accounts
		for (const accountInfo of bankAccounts) {
			const existingAccount = existingAccountMap.get(accountInfo.accountId);

			if (existingAccount) {
				// Update existing account
				await db
					.update(table.bankAccount)
					.set({
						iban: accountInfo.iban,
						accountName: accountInfo.accountName || null,
						currency: accountInfo.currency,
						accessToken: encryptedAccessToken,
						refreshToken: encryptedRefreshToken,
						tokenExpiresAt: tokenExpiresAt || null,
						updatedAt: new Date()
					})
					.where(eq(table.bankAccount.id, existingAccount.id));

				updatedAccountIds.push(existingAccount.id);
			} else {
				// Create new account
				const accountId = generateBankAccountId();

				await db.insert(table.bankAccount).values({
					id: accountId,
					tenantId: event.locals.tenant.id,
					bankName: bankName,
					accountId: accountInfo.accountId,
					iban: accountInfo.iban,
					accountName: accountInfo.accountName || null,
					currency: accountInfo.currency,
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					tokenExpiresAt: tokenExpiresAt || null,
					isActive: true
				});

				createdAccountIds.push(accountId);
			}
		}

		return {
			success: true,
			updated: updatedAccountIds.length,
			created: createdAccountIds.length
		};
	}
);

export const disconnectBankAccount = command(
	v.pipe(v.string(), v.minLength(1)),
	async (accountId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify account belongs to tenant
		const [existing] = await db
			.select()
			.from(table.bankAccount)
			.where(
				and(
					eq(table.bankAccount.id, accountId),
					eq(table.bankAccount.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Bank account not found');
		}

		// Delete account (cascade will delete transactions)
		await db.delete(table.bankAccount).where(eq(table.bankAccount.id, accountId));

		return { success: true };
	}
);

// Transaction Management

export const getTransactions = query(
	v.object({
		bankAccountId: v.optional(v.string()),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
		matched: v.optional(v.boolean()),
		isExpense: v.optional(v.boolean())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions: any = eq(table.bankTransaction.tenantId, event.locals.tenant.id);

		if (filters.bankAccountId) {
			conditions = and(conditions, eq(table.bankTransaction.bankAccountId, filters.bankAccountId));
		}

		if (filters.fromDate) {
			conditions = and(conditions, gte(table.bankTransaction.date, new Date(filters.fromDate)));
		}

		if (filters.toDate) {
			conditions = and(conditions, lte(table.bankTransaction.date, new Date(filters.toDate)));
		}

		if (filters.matched !== undefined) {
			if (filters.matched) {
				conditions = and(conditions, sql`${table.bankTransaction.matchedInvoiceId} IS NOT NULL`);
			} else {
				conditions = and(conditions, isNull(table.bankTransaction.matchedInvoiceId));
			}
		}

		if (filters.isExpense !== undefined) {
			conditions = and(conditions, eq(table.bankTransaction.isExpense, filters.isExpense));
		}

		const transactions = await db
			.select({
				// Transaction fields
				id: table.bankTransaction.id,
				tenantId: table.bankTransaction.tenantId,
				bankAccountId: table.bankTransaction.bankAccountId,
				transactionId: table.bankTransaction.transactionId,
				amount: table.bankTransaction.amount,
				currency: table.bankTransaction.currency,
				date: table.bankTransaction.date,
				description: table.bankTransaction.description,
				reference: table.bankTransaction.reference,
				counterpartIban: table.bankTransaction.counterpartIban,
				counterpartName: table.bankTransaction.counterpartName,
				category: table.bankTransaction.category,
				isExpense: table.bankTransaction.isExpense,
				expenseId: table.bankTransaction.expenseId,
				matchedInvoiceId: table.bankTransaction.matchedInvoiceId,
				matchingMethod: table.bankTransaction.matchingMethod,
				createdAt: table.bankTransaction.createdAt,
				updatedAt: table.bankTransaction.updatedAt,
				// Expense userId (if linked)
				expenseUserId: table.expense.userId,
				// Supplier name (if expense has supplier)
				expenseSupplierId: table.expense.supplierId,
				supplierName: table.supplier.name,
				// Client name (if expense has client or invoice matched)
				expenseClientId: table.expense.clientId,
				clientName: table.client.name,
				invoiceClientId: table.invoice.clientId
			})
			.from(table.bankTransaction)
			.leftJoin(table.expense, eq(table.bankTransaction.expenseId, table.expense.id))
			.leftJoin(table.supplier, eq(table.expense.supplierId, table.supplier.id))
			.leftJoin(table.client, eq(table.expense.clientId, table.client.id))
			.leftJoin(table.invoice, eq(table.bankTransaction.matchedInvoiceId, table.invoice.id))
			.where(conditions)
			.orderBy(desc(table.bankTransaction.date));

		return transactions;
	}
);

export const syncTransactions = command(
	v.object({
		bankAccountId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const { bankAccountId } = data;
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get bank account
		const [account] = await db
			.select()
			.from(table.bankAccount)
			.where(
				and(
					eq(table.bankAccount.id, bankAccountId),
					eq(table.bankAccount.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!account) {
			throw new Error('Bank account not found');
		}

		if (!BankManager.isSupported(account.bankName)) {
			throw new Error(`Unsupported bank: ${account.bankName}`);
		}

		// Decrypt tokens
		let accessToken: string;
		let refreshToken: string;

		try {
			accessToken = decryptToken(event.locals.tenant.id, account.accessToken);
			refreshToken = decryptToken(event.locals.tenant.id, account.refreshToken);
		} catch (error) {
			throw new Error('Failed to decrypt tokens');
		}

		// Get client (handle Revolut specially)
		let client;
		if (account.bankName === 'revolut') {
			const revolutConfig = await getRevolutConfigForClient(event.locals.tenant.id);
			if (!revolutConfig) {
				throw new Error(
					'Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.'
				);
			}
			client = new RevolutClient(revolutConfig);
		} else {
			client = BankManager.getClient(account.bankName as BankName);
		}

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
					accessToken: encryptToken(event.locals.tenant.id, tokens.accessToken),
					refreshToken: encryptToken(event.locals.tenant.id, tokens.refreshToken),
					tokenExpiresAt: tokens.expiresAt,
					updatedAt: new Date()
				})
				.where(eq(table.bankAccount.id, bankAccountId));
		}

		// Validate access token before using
		if (!accessToken) {
			throw new Error('Access token is missing. Please reconnect the bank account.');
		}

		const fromDate = account.lastSyncedAt || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Last 90 days or since last sync
		const transactions = await client.getTransactions(
			accessToken,
			account.accountId,
			fromDate,
			new Date()
		);

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
					tenantId: event.locals.tenant.id,
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

				// Auto-create expense for negative transactions
				if (txn.amount < 0) {
					const expenseId = generateExpenseId();
					await db.insert(table.expense).values({
						id: expenseId,
						tenantId: event.locals.tenant.id,
						bankTransactionId: transactionDbId,
						description: txn.description || txn.reference || 'Expense from transaction',
						amount: Math.abs(txn.amount), // Store as positive value
						currency: txn.currency,
						date: txn.date,
						createdByUserId: event.locals.user.id
					});

					// Link transaction to expense
					await db
						.update(table.bankTransaction)
						.set({
							expenseId: expenseId,
							updatedAt: new Date()
						})
						.where(eq(table.bankTransaction.id, transactionDbId));

					// Auto-link expense to supplier using matching rules
					const matchingRule = await findMatchingRule(
						newTransaction,
						event.locals.tenant.id,
						'supplier'
					);
					if (matchingRule && matchingRule.supplierId) {
						await db
							.update(table.expense)
							.set({
								supplierId: matchingRule.supplierId,
								updatedAt: new Date()
							})
							.where(eq(table.expense.id, expenseId));

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
				} else if (newTransaction) {
					// For incoming transactions, try to match to client using matching rules
					const matchingRule = await findMatchingRule(
						newTransaction,
						event.locals.tenant.id,
						'client'
					);
					if (matchingRule && matchingRule.clientId) {
						// Try to match to an invoice for this client
						// This complements the existing IBAN-based invoice matching
						const invoices = await db
							.select()
							.from(table.invoice)
							.where(
								and(
									eq(table.invoice.tenantId, event.locals.tenant.id),
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
								tenantId: event.locals.tenant.id,
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
	}
);

export const matchTransactionToInvoice = command(
	v.object({
		transactionId: v.string(),
		invoiceId: v.string(),
		matchingMethod: v.optional(v.string()) // 'manual', 'iban-amount', 'invoice-number'
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify transaction belongs to tenant
		const [transaction] = await db
			.select()
			.from(table.bankTransaction)
			.where(
				and(
					eq(table.bankTransaction.id, data.transactionId),
					eq(table.bankTransaction.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!transaction) {
			throw new Error('Transaction not found');
		}

		// Verify invoice belongs to tenant
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, data.invoiceId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!invoice) {
			throw new Error('Invoice not found');
		}

		// Update transaction
		await db
			.update(table.bankTransaction)
			.set({
				matchedInvoiceId: data.invoiceId,
				matchingMethod: data.matchingMethod || 'manual',
				updatedAt: new Date()
			})
			.where(eq(table.bankTransaction.id, data.transactionId));

		// Create match record
		const matchId = generateMatchId();
		await db.insert(table.transactionInvoiceMatch).values({
			id: matchId,
			tenantId: event.locals.tenant.id,
			transactionId: data.transactionId,
			invoiceId: data.invoiceId,
			matchingMethod: data.matchingMethod || 'manual',
			matchedByUserId: event.locals.user.id
		});

		// Mark invoice as paid if it's not already paid
		if (invoice.status !== 'paid') {
			await db
				.update(table.invoice)
				.set({
					status: 'paid',
					paidDate: transaction.date,
					updatedAt: new Date()
				})
				.where(eq(table.invoice.id, data.invoiceId));
		}

		// Create matching rule for client (learn from this manual match)
		if (invoice.clientId) {
			await createMatchRuleFromTransaction(
				transaction,
				event.locals.tenant.id,
				'client',
				undefined,
				invoice.clientId,
				event.locals.user.id
			);
		}

		return { success: true };
	}
);

export const unmatchTransactionFromInvoice = command(
	v.pipe(v.string(), v.minLength(1)),
	async (transactionId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify transaction belongs to tenant
		const [transaction] = await db
			.select()
			.from(table.bankTransaction)
			.where(
				and(
					eq(table.bankTransaction.id, transactionId),
					eq(table.bankTransaction.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!transaction || !transaction.matchedInvoiceId) {
			throw new Error('Transaction not found or not matched');
		}

		const invoiceId = transaction.matchedInvoiceId;

		// Update transaction
		await db
			.update(table.bankTransaction)
			.set({
				matchedInvoiceId: null,
				matchingMethod: null,
				updatedAt: new Date()
			})
			.where(eq(table.bankTransaction.id, transactionId));

		// Delete match records
		await db
			.delete(table.transactionInvoiceMatch)
			.where(
				and(
					eq(table.transactionInvoiceMatch.transactionId, transactionId),
					eq(table.transactionInvoiceMatch.tenantId, event.locals.tenant.id)
				)
			);

		// Optionally update invoice status back to 'sent' (user decision)
		// For now, we'll leave the invoice status as is

		return { success: true };
	}
);

export const getUnmatchedTransactions = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const transactions = await db
		.select()
		.from(table.bankTransaction)
		.where(
			and(
				eq(table.bankTransaction.tenantId, event.locals.tenant.id),
				isNull(table.bankTransaction.matchedInvoiceId),
				sql`${table.bankTransaction.isExpense} = 0` // Only incoming transactions (not expenses)
			)
		)
		.orderBy(desc(table.bankTransaction.date));

	return transactions;
});

export const getClientCredit = query(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Get all invoices for client
	const invoices = await db
		.select()
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, event.locals.tenant.id),
				eq(table.invoice.clientId, clientId),
				or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'overdue'))
			)
		);

	const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

	// Get paid invoices
	const paidInvoices = await db
		.select()
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, event.locals.tenant.id),
				eq(table.invoice.clientId, clientId),
				eq(table.invoice.status, 'paid')
			)
		);

	const totalPaid = paidInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

	return {
		totalInvoiced,
		totalPaid,
		remainingCredit: totalInvoiced - totalPaid,
		unpaidInvoices: invoices.length,
		paidInvoices: paidInvoices.length
	};
});

// Expense Management

export const getExpenses = query(
	v.object({
		supplierId: v.optional(v.string()),
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string()),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
		category: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions: any = eq(table.expense.tenantId, event.locals.tenant.id);

		if (filters.supplierId) {
			conditions = and(conditions, eq(table.expense.supplierId, filters.supplierId));
		}

		if (filters.clientId) {
			conditions = and(conditions, eq(table.expense.clientId, filters.clientId));
		}

		if (filters.projectId) {
			conditions = and(conditions, eq(table.expense.projectId, filters.projectId));
		}

		if (filters.fromDate) {
			conditions = and(conditions, gte(table.expense.date, new Date(filters.fromDate)));
		}

		if (filters.toDate) {
			conditions = and(conditions, lte(table.expense.date, new Date(filters.toDate)));
		}

		if (filters.category) {
			conditions = and(conditions, eq(table.expense.category, filters.category));
		}

		const expenses = await db
			.select()
			.from(table.expense)
			.where(conditions)
			.orderBy(desc(table.expense.date));

		return expenses;
	}
);

export const createExpense = command(
	v.object({
		bankTransactionId: v.optional(v.string()),
		supplierId: v.optional(v.string()),
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string()),
		category: v.optional(v.string()),
		description: v.string(),
		amount: v.number(),
		currency: v.optional(v.string()),
		date: v.string(),
		vatRate: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const expenseId = generateExpenseId();
		const amount = Math.round(data.amount * 100); // Convert to cents
		const vatRate = data.vatRate ? Math.round(data.vatRate * 100) : null;
		const vatAmount = vatRate ? Math.round((amount * vatRate) / 10000) : null;

		await db.insert(table.expense).values({
			id: expenseId,
			tenantId: event.locals.tenant.id,
			bankTransactionId: data.bankTransactionId || null,
			supplierId: data.supplierId || null,
			clientId: data.clientId || null,
			projectId: data.projectId || null,
			category: data.category || null,
			description: data.description,
			amount,
			currency: data.currency || 'RON',
			date: new Date(data.date),
			vatRate,
			vatAmount,
			createdByUserId: event.locals.user.id
		});

		// Link transaction to expense if provided
		if (data.bankTransactionId) {
			await db
				.update(table.bankTransaction)
				.set({
					expenseId: expenseId,
					updatedAt: new Date()
				})
				.where(eq(table.bankTransaction.id, data.bankTransactionId));
		}

		// Auto-link to supplier using matching rules if supplierId not provided
		if (!data.supplierId && data.bankTransactionId) {
			const [transaction] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.id, data.bankTransactionId),
						eq(table.bankTransaction.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (transaction) {
				const matchingRule = await findMatchingRule(
					transaction,
					event.locals.tenant.id,
					'supplier'
				);
				if (matchingRule && matchingRule.supplierId) {
					// Update expense with matched supplier
					await db
						.update(table.expense)
						.set({
							supplierId: matchingRule.supplierId,
							updatedAt: new Date()
						})
						.where(eq(table.expense.id, expenseId));

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

		// Create matching rule if supplier was provided
		if (data.supplierId && data.bankTransactionId) {
			const [transaction] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.id, data.bankTransactionId),
						eq(table.bankTransaction.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (transaction) {
				await createMatchRuleFromTransaction(
					transaction,
					event.locals.tenant.id,
					'supplier',
					data.supplierId,
					undefined,
					event.locals.user.id
				);
			}
		}

		return { success: true, expenseId };
	}
);

export const updateExpense = command(
	v.object({
		expenseId: v.string(),
		supplierId: v.optional(v.string()),
		clientId: v.optional(v.string()),
		projectId: v.optional(v.string()),
		category: v.optional(v.string()),
		description: v.optional(v.string()),
		amount: v.optional(v.number()),
		currency: v.optional(v.string()),
		date: v.optional(v.string()),
		vatRate: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { expenseId, ...updateData } = data;

		// Verify expense belongs to tenant
		const [existing] = await db
			.select()
			.from(table.expense)
			.where(
				and(eq(table.expense.id, expenseId), eq(table.expense.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!existing) {
			throw new Error('Expense not found');
		}

		const updateValues: any = {
			updatedAt: new Date()
		};

		if (updateData.supplierId !== undefined) {
			updateValues.supplierId = updateData.supplierId || null;
		}
		if (updateData.clientId !== undefined) {
			updateValues.clientId = updateData.clientId || null;
		}
		if (updateData.projectId !== undefined) {
			updateValues.projectId = updateData.projectId || null;
		}
		if (updateData.category !== undefined) {
			updateValues.category = updateData.category || null;
		}
		if (updateData.description !== undefined) {
			updateValues.description = updateData.description;
		}
		if (updateData.amount !== undefined) {
			updateValues.amount = Math.round(updateData.amount * 100);
		}
		if (updateData.currency !== undefined) {
			updateValues.currency = updateData.currency;
		}
		if (updateData.date !== undefined) {
			updateValues.date = new Date(updateData.date);
		}
		if (updateData.vatRate !== undefined) {
			const vatRate = updateData.vatRate ? Math.round(updateData.vatRate * 100) : null;
			updateValues.vatRate = vatRate;
			updateValues.vatAmount =
				vatRate && updateValues.amount
					? Math.round((updateValues.amount * vatRate) / 10000)
					: vatRate && existing.amount
						? Math.round((existing.amount * vatRate) / 10000)
						: null;
		}

		await db.update(table.expense).set(updateValues).where(eq(table.expense.id, expenseId));

		// Create matching rule if supplier is linked and expense has a transaction
		if (updateData.supplierId && existing.bankTransactionId) {
			const [transaction] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.id, existing.bankTransactionId),
						eq(table.bankTransaction.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (transaction) {
				await createMatchRuleFromTransaction(
					transaction,
					event.locals.tenant.id,
					'supplier',
					updateData.supplierId || null,
					undefined,
					event.locals.user.id
				);
			}
		}

		return { success: true };
	}
);

export const deleteExpense = command(v.pipe(v.string(), v.minLength(1)), async (expenseId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify expense belongs to tenant
	const [existing] = await db
		.select()
		.from(table.expense)
		.where(and(eq(table.expense.id, expenseId), eq(table.expense.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Expense not found');
	}

	// Unlink from transaction if linked
	if (existing.bankTransactionId) {
		await db
			.update(table.bankTransaction)
			.set({
				expenseId: null,
				updatedAt: new Date()
			})
			.where(eq(table.bankTransaction.id, existing.bankTransactionId));
	}

	await db.delete(table.expense).where(eq(table.expense.id, expenseId));

	return { success: true };
});

export const uploadExpenseInvoice = command(
	v.object({
		expenseId: v.pipe(v.string(), v.minLength(1)),
		file: v.instance(File)
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify expense belongs to tenant
		const [existing] = await db
			.select()
			.from(table.expense)
			.where(
				and(
					eq(table.expense.id, data.expenseId),
					eq(table.expense.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Expense not found');
		}

		// Delete old invoice if exists
		if (existing.invoicePath) {
			await storage.deleteFile(existing.invoicePath);
		}

		// Upload new invoice
		const uploadResult = await storage.uploadFile(event.locals.tenant.id, data.file, {
			expenseId: data.expenseId,
			uploadedBy: event.locals.user.id,
			type: 'invoice'
		});

		// Update expense with invoice path
		await db
			.update(table.expense)
			.set({
				invoicePath: uploadResult.path,
				updatedAt: new Date()
			})
			.where(eq(table.expense.id, data.expenseId));

		return { success: true, invoicePath: uploadResult.path };
	}
);

export const getExpenseInvoiceUrl = query(v.pipe(v.string(), v.minLength(1)), async (expenseId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [expense] = await db
		.select()
		.from(table.expense)
		.where(and(eq(table.expense.id, expenseId), eq(table.expense.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!expense) {
		throw new Error('Expense not found');
	}

	if (!expense.invoicePath) {
		throw new Error('Invoice not found');
	}

	const url = await storage.getDownloadUrl(expense.invoicePath);
	return { url };
});

function generateUserBankAccountId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const linkExpenseToUser = command(
	v.object({
		expenseId: v.string(),
		userId: v.string(),
		iban: v.optional(v.string()) // User's IBAN (needed for Revolut transactions without IBAN)
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify expense belongs to tenant
		const [expense] = await db
			.select()
			.from(table.expense)
			.where(
				and(
					eq(table.expense.id, data.expenseId),
					eq(table.expense.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!expense) {
			throw new Error('Expense not found');
		}

		// Verify user belongs to tenant
		const [tenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.userId, data.userId),
					eq(table.tenantUser.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!tenantUser) {
			throw new Error('User not found in tenant');
		}

		let userIban: string | null = null;

		// Check if user already has a bank account (use the first one if multiple)
		const existingAccounts = await db
			.select()
			.from(table.userBankAccount)
			.where(
				and(
					eq(table.userBankAccount.userId, data.userId),
					eq(table.userBankAccount.tenantId, event.locals.tenant.id),
					eq(table.userBankAccount.isActive, true)
				)
			)
			.limit(1);

		// Use existing IBAN if user already has a bank account
		if (existingAccounts.length > 0 && existingAccounts[0].iban) {
			userIban = existingAccounts[0].iban;
		}

		// If user doesn't have an IBAN yet, use provided IBAN
		if (!userIban && data.iban) {
			userIban = data.iban;
		}

		// If still no IBAN, return error indicating IBAN is needed
		// We can't use the company's account IBAN - we need the user's personal IBAN
		if (!userIban) {
			return { success: false, needsIban: true };
		}

		// Check if user already has this IBAN (we already queried above, but check all accounts now)
		const allUserAccounts = await db
			.select()
			.from(table.userBankAccount)
			.where(
				and(
					eq(table.userBankAccount.userId, data.userId),
					eq(table.userBankAccount.tenantId, event.locals.tenant.id)
				)
			);

		const normalizedIban = normalizeIban(userIban);
		const hasIban = allUserAccounts.some((acc) => normalizeIban(acc.iban) === normalizedIban);

		if (!hasIban) {
			// Get transaction info if available for bank name
			let bankName: string | null = null;
			if (expense.bankTransactionId) {
				const [txn] = await db
					.select()
					.from(table.bankTransaction)
					.where(
						and(
							eq(table.bankTransaction.id, expense.bankTransactionId),
							eq(table.bankTransaction.tenantId, event.locals.tenant.id)
						)
					)
					.limit(1);
				bankName = txn?.counterpartName || null;
			}

			// Create user bank account with the IBAN
			const accountId = generateUserBankAccountId();
			await db.insert(table.userBankAccount).values({
				id: accountId,
				tenantId: event.locals.tenant.id,
				userId: data.userId,
				iban: userIban,
				bankName: bankName,
				accountName: `Auto-created from expense`,
				currency: expense.currency || 'RON',
				isActive: true
			});
		}

		// Create matching rule if expense has a transaction
		if (expense.bankTransactionId) {
			const [transaction] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.id, expense.bankTransactionId),
						eq(table.bankTransaction.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (transaction) {
				await createMatchRuleFromTransaction(
					transaction,
					event.locals.tenant.id,
					'user',
					undefined,
					undefined,
					data.userId,
					userIban
				);
			}
		}

		// Link the expense to the user
		await db
			.update(table.expense)
			.set({ userId: data.userId, updatedAt: new Date() })
			.where(eq(table.expense.id, data.expenseId));

		return { success: true };
	}
);

export const getUserTransactions = query(
	v.object({
		userId: v.optional(v.string()),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const userId = filters.userId || event.locals.user.id;

		// Verify user belongs to tenant
		const [tenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.userId, userId),
					eq(table.tenantUser.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!tenantUser) {
			throw new Error('User not found in tenant');
		}

		// Get user's bank accounts
		const allUserAccounts = await db
			.select()
			.from(table.userBankAccount)
			.where(
				and(
					eq(table.userBankAccount.userId, userId),
					eq(table.userBankAccount.tenantId, event.locals.tenant.id)
				)
			);

		// Filter active accounts
		const userAccounts = allUserAccounts.filter((acc) => acc.isActive);

		if (userAccounts.length === 0) {
			return [];
		}

		// Get transactions via two methods:
		// 1. Transactions matched by IBAN from user's bank accounts
		// 2. Transactions linked via expenses (expense.userId = userId)

		const transactionIds = new Set<string>();

		// Method 1: Get transactions matched by IBAN
		if (userAccounts.length > 0) {
			const ibans = userAccounts.map((acc) => acc.iban).filter(Boolean);
			if (ibans.length > 0) {
				let conditions: any = eq(table.bankTransaction.tenantId, event.locals.tenant.id);
				const ibanConditions = ibans.map((iban) => eq(table.bankTransaction.counterpartIban, iban));
				conditions = and(conditions, or(...ibanConditions));

				if (filters.fromDate) {
					conditions = and(conditions, gte(table.bankTransaction.date, new Date(filters.fromDate)));
				}

				if (filters.toDate) {
					conditions = and(conditions, lte(table.bankTransaction.date, new Date(filters.toDate)));
				}

				const ibanTransactions = await db
					.select({ id: table.bankTransaction.id })
					.from(table.bankTransaction)
					.where(conditions);

				ibanTransactions.forEach((t) => transactionIds.add(t.id));
			}
		}

		// Method 2: Get transactions via expenses linked to user
		let expenseConditions: any = and(
			eq(table.expense.tenantId, event.locals.tenant.id),
			eq(table.expense.userId, userId),
			isNotNull(table.expense.bankTransactionId)
		);

		if (filters.fromDate || filters.toDate) {
			// Need to join with transactions to filter by date
			const expenseTransactions = await db
				.select({ transactionId: table.expense.bankTransactionId })
				.from(table.expense)
				.innerJoin(
					table.bankTransaction,
					eq(table.expense.bankTransactionId, table.bankTransaction.id)
				)
				.where(
					and(
						expenseConditions,
						filters.fromDate
							? gte(table.bankTransaction.date, new Date(filters.fromDate))
							: undefined,
						filters.toDate ? lte(table.bankTransaction.date, new Date(filters.toDate)) : undefined
					)
				);

			expenseTransactions.forEach((e) => {
				if (e.transactionId) transactionIds.add(e.transactionId);
			});
		} else {
			const expenses = await db
				.select({ transactionId: table.expense.bankTransactionId })
				.from(table.expense)
				.where(expenseConditions);

			expenses.forEach((e) => {
				if (e.transactionId) transactionIds.add(e.transactionId);
			});
		}

		if (transactionIds.size === 0) {
			return [];
		}

		// Fetch all transactions with expense userId, supplier, and client
		const transactions = await db
			.select({
				// Transaction fields
				id: table.bankTransaction.id,
				tenantId: table.bankTransaction.tenantId,
				bankAccountId: table.bankTransaction.bankAccountId,
				transactionId: table.bankTransaction.transactionId,
				amount: table.bankTransaction.amount,
				currency: table.bankTransaction.currency,
				date: table.bankTransaction.date,
				description: table.bankTransaction.description,
				reference: table.bankTransaction.reference,
				counterpartIban: table.bankTransaction.counterpartIban,
				counterpartName: table.bankTransaction.counterpartName,
				category: table.bankTransaction.category,
				isExpense: table.bankTransaction.isExpense,
				expenseId: table.bankTransaction.expenseId,
				matchedInvoiceId: table.bankTransaction.matchedInvoiceId,
				matchingMethod: table.bankTransaction.matchingMethod,
				createdAt: table.bankTransaction.createdAt,
				updatedAt: table.bankTransaction.updatedAt,
				// Expense userId (if linked)
				expenseUserId: table.expense.userId,
				// Supplier name (if expense has supplier)
				expenseSupplierId: table.expense.supplierId,
				supplierName: table.supplier.name,
				// Client name (if expense has client or invoice matched)
				expenseClientId: table.expense.clientId,
				clientName: table.client.name,
				invoiceClientId: table.invoice.clientId
			})
			.from(table.bankTransaction)
			.leftJoin(table.expense, eq(table.bankTransaction.expenseId, table.expense.id))
			.leftJoin(table.supplier, eq(table.expense.supplierId, table.supplier.id))
			.leftJoin(table.client, eq(table.expense.clientId, table.client.id))
			.leftJoin(table.invoice, eq(table.bankTransaction.matchedInvoiceId, table.invoice.id))
			.where(
				and(
					eq(table.bankTransaction.tenantId, event.locals.tenant.id),
					inArray(table.bankTransaction.id, Array.from(transactionIds))
				)
			)
			.orderBy(desc(table.bankTransaction.date));

		return transactions;
	}
);

export const getUserSpending = query(
	v.object({
		userId: v.optional(v.string()),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const userId = filters.userId || event.locals.user.id;

		// Verify user belongs to tenant
		const [tenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.userId, userId),
					eq(table.tenantUser.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!tenantUser) {
			throw new Error('User not found in tenant');
		}

		// Get user's bank accounts
		const allUserAccounts = await db
			.select()
			.from(table.userBankAccount)
			.where(
				and(
					eq(table.userBankAccount.userId, userId),
					eq(table.userBankAccount.tenantId, event.locals.tenant.id)
				)
			);

		// Calculate spending from expenses linked to the user
		// This is the primary source since expenses are explicitly linked
		let expenseConditions: any = and(
			eq(table.expense.tenantId, event.locals.tenant.id),
			eq(table.expense.userId, userId)
		);

		if (filters.fromDate) {
			expenseConditions = and(
				expenseConditions,
				gte(table.expense.date, new Date(filters.fromDate))
			);
		}

		if (filters.toDate) {
			expenseConditions = and(expenseConditions, lte(table.expense.date, new Date(filters.toDate)));
		}

		const expenses = await db.select().from(table.expense).where(expenseConditions);

		// Calculate totals from expenses
		const byCurrency: Record<string, { total: number; count: number }> = {};
		let totalSpending = 0;
		let transactionCount = expenses.length;

		for (const expense of expenses) {
			const currency = expense.currency || 'RON';
			const amount = expense.amount; // Already in cents

			if (!byCurrency[currency]) {
				byCurrency[currency] = { total: 0, count: 0 };
			}

			byCurrency[currency].total += amount;
			byCurrency[currency].count += 1;
			totalSpending += amount;
		}

		// Also include transactions matched by IBAN (for backward compatibility)
		// but only if they don't already have an expense linked
		const userAccounts = allUserAccounts.filter((acc) => acc.isActive);
		if (userAccounts.length > 0) {
			const ibans = userAccounts.map((acc) => acc.iban).filter(Boolean);
			if (ibans.length > 0) {
				let transactionConditions: any = and(
					eq(table.bankTransaction.tenantId, event.locals.tenant.id),
					sql`${table.bankTransaction.amount} < 0`,
					isNull(table.bankTransaction.expenseId) // Only transactions without expenses
				);

				const ibanConditions = ibans.map((iban) => eq(table.bankTransaction.counterpartIban, iban));
				transactionConditions = and(transactionConditions, or(...ibanConditions));

				if (filters.fromDate) {
					transactionConditions = and(
						transactionConditions,
						gte(table.bankTransaction.date, new Date(filters.fromDate))
					);
				}

				if (filters.toDate) {
					transactionConditions = and(
						transactionConditions,
						lte(table.bankTransaction.date, new Date(filters.toDate))
					);
				}

				const transactions = await db
					.select()
					.from(table.bankTransaction)
					.where(transactionConditions);

				for (const txn of transactions) {
					const currency = txn.currency || 'RON';
					const amount = Math.abs(txn.amount); // Convert to positive

					if (!byCurrency[currency]) {
						byCurrency[currency] = { total: 0, count: 0 };
					}

					byCurrency[currency].total += amount;
					byCurrency[currency].count += 1;
					totalSpending += amount;
					transactionCount += 1;
				}
			}
		}

		return {
			totalSpending,
			transactionCount,
			byCurrency
		};
	}
);

// Batch Auto-Linking Commands

export const autoLinkExpensesToSuppliers = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Find all expenses without supplierId that have a bankTransactionId
	const expenses = await db
		.select()
		.from(table.expense)
		.where(
			and(
				eq(table.expense.tenantId, event.locals.tenant.id),
				isNull(table.expense.supplierId),
				sql`${table.expense.bankTransactionId} IS NOT NULL`
			)
		);

	let linkedCount = 0;

	for (const expense of expenses) {
		if (!expense.bankTransactionId) continue;

		// Get the transaction
		const [transaction] = await db
			.select()
			.from(table.bankTransaction)
			.where(
				and(
					eq(table.bankTransaction.id, expense.bankTransactionId),
					eq(table.bankTransaction.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!transaction) continue;

		// Find matching rule
		const matchingRule = await findMatchingRule(transaction, event.locals.tenant.id, 'supplier');
		if (matchingRule && matchingRule.supplierId) {
			// Update expense with matched supplier
			await db
				.update(table.expense)
				.set({
					supplierId: matchingRule.supplierId,
					updatedAt: new Date()
				})
				.where(eq(table.expense.id, expense.id));

			// Increment match count and update last matched timestamp
			await db
				.update(table.transactionMatchRule)
				.set({
					matchCount: sql`${table.transactionMatchRule.matchCount} + 1`,
					lastMatchedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(table.transactionMatchRule.id, matchingRule.id));

			linkedCount++;
		}
	}

	return { success: true, linkedCount };
});

// Find similar expenses (same counterpart or description)
export const findSimilarExpenses = query(
	v.object({
		expenseId: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get the expense
		const [expense] = await db
			.select()
			.from(table.expense)
			.where(
				and(
					eq(table.expense.id, data.expenseId),
					eq(table.expense.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!expense) {
			throw new Error('Expense not found');
		}

		// Get the transaction if it exists
		let transaction: typeof table.bankTransaction.$inferSelect | null = null;
		if (expense.bankTransactionId) {
			const [txn] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.id, expense.bankTransactionId),
						eq(table.bankTransaction.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);
			transaction = txn || null;
		}

		// Collect expense IDs that match
		const matchingExpenseIds: string[] = [];

		// If we have a transaction, match by counterpart
		if (transaction) {
			// Match by IBAN if available
			if (transaction.counterpartIban) {
				const normalizedIban = normalizeIban(transaction.counterpartIban);
				// Find expenses with transactions that have the same IBAN
				const expensesWithSameIban = await db
					.select({ expenseId: table.expense.id })
					.from(table.expense)
					.innerJoin(
						table.bankTransaction,
						eq(table.expense.bankTransactionId, table.bankTransaction.id)
					)
					.where(
						and(
							eq(table.expense.tenantId, event.locals.tenant.id),
							sql`${table.expense.id} != ${data.expenseId}`,
							isNull(table.expense.supplierId),
							sql`REPLACE(UPPER(${table.bankTransaction.counterpartIban}), ' ', '') = ${normalizedIban}`
						)
					);
				matchingExpenseIds.push(...expensesWithSameIban.map((e) => e.expenseId));
			}

			// Match by counterpart name if available
			if (transaction.counterpartName) {
				const expensesWithSameName = await db
					.select({ expenseId: table.expense.id })
					.from(table.expense)
					.innerJoin(
						table.bankTransaction,
						eq(table.expense.bankTransactionId, table.bankTransaction.id)
					)
					.where(
						and(
							eq(table.expense.tenantId, event.locals.tenant.id),
							sql`${table.expense.id} != ${data.expenseId}`,
							isNull(table.expense.supplierId),
							eq(table.bankTransaction.counterpartName, transaction.counterpartName)
						)
					);
				matchingExpenseIds.push(...expensesWithSameName.map((e) => e.expenseId));
			}
		}

		// Also match by description (fuzzy match)
		if (expense.description) {
			const descriptionPattern = extractDescriptionPattern(expense.description);
			if (descriptionPattern) {
				// Find expenses with similar descriptions
				const similarExpenses = await db
					.select()
					.from(table.expense)
					.where(
						and(
							eq(table.expense.tenantId, event.locals.tenant.id),
							sql`${table.expense.id} != ${data.expenseId}`,
							isNull(table.expense.supplierId),
							sql`${table.expense.description} LIKE ${`%${descriptionPattern}%`}`
						)
					);
				matchingExpenseIds.push(...similarExpenses.map((e) => e.id));
			}
		}

		// Remove duplicates
		const uniqueIds = [...new Set(matchingExpenseIds)];

		if (uniqueIds.length === 0) {
			return [];
		}

		// Get the actual expenses
		const similarExpenses = await db
			.select()
			.from(table.expense)
			.where(inArray(table.expense.id, uniqueIds))
			.orderBy(desc(table.expense.date));

		return similarExpenses;
	}
);

// Link multiple expenses to a supplier
export const linkSimilarExpensesToSupplier = command(
	v.object({
		expenseId: v.string(),
		supplierId: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Find similar expenses
		const similarExpenses = await findSimilarExpenses({ expenseId: data.expenseId });

		// Link all similar expenses to the supplier
		let linkedCount = 0;
		for (const expense of similarExpenses) {
			// Update expense
			await db
				.update(table.expense)
				.set({
					supplierId: data.supplierId,
					updatedAt: new Date()
				})
				.where(eq(table.expense.id, expense.id));

			// Create matching rule if expense has a transaction
			if (expense.bankTransactionId) {
				const [transaction] = await db
					.select()
					.from(table.bankTransaction)
					.where(
						and(
							eq(table.bankTransaction.id, expense.bankTransactionId),
							eq(table.bankTransaction.tenantId, event.locals.tenant.id)
						)
					)
					.limit(1);

				if (transaction) {
					await createMatchRuleFromTransaction(
						transaction,
						event.locals.tenant.id,
						'supplier',
						data.supplierId,
						undefined,
						event.locals.user.id
					);
				}
			}

			linkedCount++;
		}

		return { success: true, linkedCount };
	}
);

// Find similar expenses for user linking (same counterpart or description)
export const findSimilarExpensesForUser = query(
	v.object({
		expenseId: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get the expense
		const [expense] = await db
			.select()
			.from(table.expense)
			.where(
				and(
					eq(table.expense.id, data.expenseId),
					eq(table.expense.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!expense) {
			throw new Error('Expense not found');
		}

		// Get the transaction if it exists
		let transaction: typeof table.bankTransaction.$inferSelect | null = null;
		if (expense.bankTransactionId) {
			const [txn] = await db
				.select()
				.from(table.bankTransaction)
				.where(
					and(
						eq(table.bankTransaction.id, expense.bankTransactionId),
						eq(table.bankTransaction.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);
			transaction = txn || null;
		}

		// Collect expense IDs that match
		const matchingExpenseIds: string[] = [];

		// If we have a transaction, match by counterpart
		if (transaction) {
			// Match by IBAN if available (counterpart IBAN is the supplier, but we match by transaction pattern)
			if (transaction.counterpartIban) {
				const normalizedIban = normalizeIban(transaction.counterpartIban);
				// Find expenses with transactions that have the same counterpart IBAN
				const expensesWithSameIban = await db
					.select({ expenseId: table.expense.id })
					.from(table.expense)
					.innerJoin(
						table.bankTransaction,
						eq(table.expense.bankTransactionId, table.bankTransaction.id)
					)
					.where(
						and(
							eq(table.expense.tenantId, event.locals.tenant.id),
							sql`${table.expense.id} != ${data.expenseId}`,
							sql`REPLACE(UPPER(${table.bankTransaction.counterpartIban}), ' ', '') = ${normalizedIban}`
						)
					);
				matchingExpenseIds.push(...expensesWithSameIban.map((e) => e.expenseId));
			}

			// Match by counterpart name if available
			if (transaction.counterpartName) {
				const expensesWithSameName = await db
					.select({ expenseId: table.expense.id })
					.from(table.expense)
					.innerJoin(
						table.bankTransaction,
						eq(table.expense.bankTransactionId, table.bankTransaction.id)
					)
					.where(
						and(
							eq(table.expense.tenantId, event.locals.tenant.id),
							sql`${table.expense.id} != ${data.expenseId}`,
							eq(table.bankTransaction.counterpartName, transaction.counterpartName)
						)
					);
				matchingExpenseIds.push(...expensesWithSameName.map((e) => e.expenseId));
			}
		}

		// Also match by description (fuzzy match)
		if (expense.description) {
			const descriptionPattern = extractDescriptionPattern(expense.description);
			if (descriptionPattern) {
				// Find expenses with similar descriptions
				const similarExpenses = await db
					.select()
					.from(table.expense)
					.where(
						and(
							eq(table.expense.tenantId, event.locals.tenant.id),
							sql`${table.expense.id} != ${data.expenseId}`,
							sql`${table.expense.description} LIKE ${`%${descriptionPattern}%`}`
						)
					);
				matchingExpenseIds.push(...similarExpenses.map((e) => e.id));
			}
		}

		// Remove duplicates
		const uniqueIds = [...new Set(matchingExpenseIds)];

		if (uniqueIds.length === 0) {
			return [];
		}

		// Get the actual expenses
		const similarExpenses = await db
			.select()
			.from(table.expense)
			.where(inArray(table.expense.id, uniqueIds))
			.orderBy(desc(table.expense.date));

		return similarExpenses;
	}
);

// Link multiple similar expenses to a user
export const linkSimilarExpensesToUser = command(
	v.object({
		expenseId: v.string(),
		userId: v.string(),
		iban: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Find similar expenses
		const similarExpenses = await findSimilarExpensesForUser({ expenseId: data.expenseId });

		// Link all similar expenses to the user
		let linkedCount = 0;
		for (const expense of similarExpenses) {
			// Link expense to user (this will create bank account if needed)
			await linkExpenseToUser({
				expenseId: expense.id,
				userId: data.userId,
				iban: data.iban || undefined
			});
			linkedCount++;
		}

		return { success: true, linkedCount };
	}
);

export const autoLinkTransactionsToClients = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Find all unmatched incoming transactions
	const transactions = await db
		.select()
		.from(table.bankTransaction)
		.where(
			and(
				eq(table.bankTransaction.tenantId, event.locals.tenant.id),
				isNull(table.bankTransaction.matchedInvoiceId),
				sql`${table.bankTransaction.amount} > 0` // Only incoming
			)
		);

	let linkedCount = 0;

	for (const transaction of transactions) {
		// Find matching rule
		const matchingRule = await findMatchingRule(transaction, event.locals.tenant.id, 'client');
		if (matchingRule && matchingRule.clientId) {
			// Try to match to an invoice for this client
			const invoices = await db
				.select()
				.from(table.invoice)
				.where(
					and(
						eq(table.invoice.tenantId, event.locals.tenant.id),
						eq(table.invoice.clientId, matchingRule.clientId),
						or(eq(table.invoice.status, 'sent'), eq(table.invoice.status, 'overdue')),
						sql`ABS(${table.invoice.totalAmount} - ${transaction.amount}) <= 1`, // Amount match within 1 cent
						sql`${table.invoice.issueDate} <= ${transaction.date}`
					)
				)
				.orderBy(sql`ABS(${table.invoice.totalAmount} - ${transaction.amount}) ASC`)
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
					.where(eq(table.bankTransaction.id, transaction.id));

				// Create match record
				const matchId = generateMatchId();
				await db.insert(table.transactionInvoiceMatch).values({
					id: matchId,
					tenantId: event.locals.tenant.id,
					transactionId: transaction.id,
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
							paidDate: transaction.date,
							updatedAt: new Date()
						})
						.where(eq(table.invoice.id, invoice.id));
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

				linkedCount++;
			}
		}
	}

	return { success: true, linkedCount };
});
