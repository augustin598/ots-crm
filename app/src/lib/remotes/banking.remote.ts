import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, gte, lte, or, isNull, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { BankManager } from '$lib/server/plugins/banking/shared/manager';
import type { BankName } from '$lib/server/plugins/banking/shared/types';
import { encryptToken, decryptToken } from '$lib/server/plugins/banking/shared/crypto';
import { redirect } from '@sveltejs/kit';
import { RevolutClient } from '$lib/server/plugins/banking/revolut/client';
import { getRevolutConfigForClient } from '$lib/server/plugins/banking/revolut/config';

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

export const getBankConnectionUrl = query(
	v.pipe(v.string(), v.minLength(1)),
	async (bankName) => {
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
				throw new Error('Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.');
			}
			client = new RevolutClient(revolutConfig);
		} else {
			client = BankManager.getClient(bankName as BankName);
		}

		const state = crypto.randomUUID();
		const redirectUri = `${event.url.origin}/${event.locals.tenant.slug}/settings/banking/callback`;

		const authUrl = client.getAuthorizationUrl(state, redirectUri);

		// Store state in session or database for validation (simplified - use session in production)
		return { authUrl, state };
	}
);

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
				throw new Error('Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.');
			}
			client = new RevolutClient(revolutConfig);
		} else {
			client = BankManager.getClient(data.bankName as BankName);
		}

		const redirectUri = `${event.url.origin}/${event.locals.tenant.slug}/settings/banking/callback`;

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
			.where(and(eq(table.bankAccount.id, accountId), eq(table.bankAccount.tenantId, event.locals.tenant.id)))
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
			conditions = and(conditions, eq(table.bankTransaction.isExpense, filters.isExpense ? 1 : 0));
		}

		const transactions = await db
			.select()
			.from(table.bankTransaction)
			.where(conditions)
			.orderBy(desc(table.bankTransaction.date));

		return transactions;
	}
);

export const syncTransactions = command(
	v.pipe(v.string(), v.minLength(1)),
	async (bankAccountId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get bank account
		const [account] = await db
			.select()
			.from(table.bankAccount)
			.where(and(eq(table.bankAccount.id, bankAccountId), eq(table.bankAccount.tenantId, event.locals.tenant.id)))
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
				throw new Error('Revolut is not configured. Please configure Revolut in Settings → Plugins → Revolut.');
			}
			client = new RevolutClient(revolutConfig);
		} else {
			client = BankManager.getClient(account.bankName as BankName);
		}

		// Check if token is expired and refresh if needed
		if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
			const tokens = await client.refreshTokens(refreshToken);

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
		const fromDate = account.lastSyncedAt || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Last 90 days or since last sync
		const transactions = await client.getTransactions(accessToken, account.accountId, fromDate, new Date());

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
			.where(and(eq(table.invoice.id, data.invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
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

export const getClientCredit = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
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
	}
);

// Expense Management

export const getExpenses = query(
	v.object({
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
		const vatAmount = vatRate ? Math.round(amount * vatRate / 10000) : null;

		await db.insert(table.expense).values({
			id: expenseId,
			tenantId: event.locals.tenant.id,
			bankTransactionId: data.bankTransactionId || null,
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

		return { success: true, expenseId };
	}
);

export const updateExpense = command(
	v.object({
		expenseId: v.string(),
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
			.where(and(eq(table.expense.id, expenseId), eq(table.expense.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Expense not found');
		}

		const updateValues: any = {
			updatedAt: new Date()
		};

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
			updateValues.vatAmount = vatRate && updateValues.amount
				? Math.round(updateValues.amount * vatRate / 10000)
				: (vatRate && existing.amount ? Math.round(existing.amount * vatRate / 10000) : null);
		}

		await db.update(table.expense).set(updateValues).where(eq(table.expense.id, expenseId));

		return { success: true };
	}
);

export const deleteExpense = command(
	v.pipe(v.string(), v.minLength(1)),
	async (expenseId) => {
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
	}
);
