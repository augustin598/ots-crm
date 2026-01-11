/**
 * Background job endpoint for syncing bank transactions
 * Can be called by external cron service or scheduled task runner
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { BankManager } from '$lib/server/plugins/banking/shared/manager';
import { decryptToken, encryptToken } from '$lib/server/plugins/banking/shared/crypto';
import { autoMatchTransactions } from '$lib/server/plugins/banking/shared/matcher';
import { env } from '$env/dynamic/private';

/**
 * Sync transactions for all active bank accounts
 * This endpoint should be called periodically (e.g., every 15-30 minutes)
 */
export const POST: RequestHandler = async (event) => {
	// Optional: Add API key authentication for security
	const apiKey = event.request.headers.get('X-API-Key');
	const expectedApiKey = env.BANKING_SYNC_API_KEY;

	if (expectedApiKey && apiKey !== expectedApiKey) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// Get all active bank accounts
		const accounts = await db
			.select()
			.from(table.bankAccount)
			.where(eq(table.bankAccount.isActive, true));

		const results: Array<{ accountId: string; tenantId: string; synced: number; matched: number; error?: string }> =
			[];

		for (const account of accounts) {
			try {
				if (!BankManager.isSupported(account.bankName)) {
					results.push({
						accountId: account.id,
						tenantId: account.tenantId,
						synced: 0,
						matched: 0,
						error: `Unsupported bank: ${account.bankName}`
					});
					continue;
				}

				// Decrypt tokens
				let accessToken: string;
				let refreshToken: string;

				try {
					accessToken = decryptToken(account.tenantId, account.accessToken);
					refreshToken = decryptToken(account.tenantId, account.refreshToken);
				} catch (error) {
					results.push({
						accountId: account.id,
						tenantId: account.tenantId,
						synced: 0,
						matched: 0,
						error: 'Failed to decrypt tokens'
					});
					continue;
				}

				// Check if token is expired and refresh if needed
				if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
					const client = BankManager.getClient(account.bankName as any);
					const tokens = await client.refreshTokens(refreshToken);

					accessToken = tokens.accessToken;

					// Update tokens in database
					await db
						.update(table.bankAccount)
						.set({
							accessToken: encryptToken(account.tenantId, tokens.accessToken),
							refreshToken: encryptToken(account.tenantId, tokens.refreshToken),
							tokenExpiresAt: tokens.expiresAt,
							updatedAt: new Date()
						})
						.where(eq(table.bankAccount.id, account.id));
				}

				// Get client and fetch transactions
				const client = BankManager.getClient(account.bankName as any);
				const fromDate = account.lastSyncedAt || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Last 90 days
				const transactions = await client.getTransactions(accessToken, account.accountId, fromDate, new Date());

				// Store transactions
				let syncedCount = 0;
				const { encodeBase32LowerCase } = await import('@oslojs/encoding');

				for (const txn of transactions) {
					// Check if transaction already exists
					const [existing] = await db
						.select()
						.from(table.bankTransaction)
						.where(
							and(
								eq(table.bankTransaction.bankAccountId, account.id),
								eq(table.bankTransaction.transactionId, txn.transactionId)
							)
						)
						.limit(1);

					if (!existing) {
						const transactionDbId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

						await db.insert(table.bankTransaction).values({
							id: transactionDbId,
							tenantId: account.tenantId,
							bankAccountId: account.id,
							transactionId: txn.transactionId,
							amount: txn.amount,
							currency: txn.currency,
							date: txn.date,
							description: txn.description || null,
							reference: txn.reference || null,
							counterpartIban: txn.counterpartIban || null,
							counterpartName: txn.counterpartName || null,
							category: txn.category || null,
							isExpense: txn.amount < 0 // Negative amounts are expenses
						});

						syncedCount++;
					}
				}

				// Update last synced timestamp
				await db
					.update(table.bankAccount)
					.set({
						lastSyncedAt: new Date(),
						updatedAt: new Date()
					})
					.where(eq(table.bankAccount.id, account.id));

				// Auto-match transactions
				const matchedCount = await autoMatchTransactions(account.tenantId);

				results.push({
					accountId: account.id,
					tenantId: account.tenantId,
					synced: syncedCount,
					matched: matchedCount
				});
			} catch (error) {
				results.push({
					accountId: account.id,
					tenantId: account.tenantId,
					synced: 0,
					matched: 0,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}

		return json({
			success: true,
			results,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('[Banking Sync] Error:', error);
		return json(
			{
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: new Date().toISOString()
			},
			{ status: 500 }
		);
	}
};
