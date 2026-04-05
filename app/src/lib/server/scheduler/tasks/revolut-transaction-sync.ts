import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { syncRevolutTransactionsForAccount } from '../../plugins/banking/revolut/sync';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Process Revolut transaction sync - finds all active Revolut bank accounts
 * and syncs transactions for the last 2 days
 */
export async function processRevolutTransactionSync(params: Record<string, any> = {}) {
	try {
		// Get all active Revolut bank accounts
		const accounts = await db
			.select({
				id: table.bankAccount.id,
				tenantId: table.bankAccount.tenantId
			})
			.from(table.bankAccount)
			.where(and(eq(table.bankAccount.bankName, 'revolut'), eq(table.bankAccount.isActive, true)));

		if (accounts.length === 0) {
			logInfo('scheduler', 'Revolut transaction sync: no active accounts found, skipping', { metadata: { activeAccounts: 0 } });
			return {
				success: true,
				accountsProcessed: 0,
				totalTransactionsSynced: 0
			};
		}

		let accountsProcessed = 0;
		let totalTransactionsSynced = 0;
		const errors: Array<{ accountId: string; tenantId: string; error: string }> = [];

		// Process each account
		for (const account of accounts) {
			try {
				logInfo('scheduler', `Revolut transaction sync: syncing account`, { tenantId: account.tenantId, metadata: { accountId: account.id } });

				const result = await syncRevolutTransactionsForAccount(
					account.tenantId,
					account.id,
					2 // 2 days
				);

				accountsProcessed++;
				totalTransactionsSynced += result.transactionsSynced;

				logInfo('scheduler', `Revolut transaction sync: account completed`, { tenantId: account.tenantId, metadata: { accountId: account.id, transactionsSynced: result.transactionsSynced } });
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Revolut transaction sync: error syncing account ${account.id}: ${message}`, { tenantId: account.tenantId, stackTrace: stack });
				errors.push({
					accountId: account.id,
					tenantId: account.tenantId,
					error: message
				});
				// Continue with other accounts
			}
		}

		logInfo('scheduler', `Revolut transaction sync completed`, { metadata: { accountsProcessed, totalTransactionsSynced } });

		return {
			success: true,
			accountsProcessed,
			totalTransactionsSynced,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Revolut transaction sync: process error: ${message}`, { stackTrace: stack });
		return {
			success: false,
			accountsProcessed: 0,
			totalTransactionsSynced: 0,
			error: 'Failed to process Revolut transaction sync'
		};
	}
}
