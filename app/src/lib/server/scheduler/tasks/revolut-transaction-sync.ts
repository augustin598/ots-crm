import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { syncRevolutTransactionsForAccount } from '../../plugins/banking/revolut/sync';

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
			console.log('[Revolut-Sync] No active Revolut bank accounts found. Skipping sync.');
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
				console.log(
					`[Revolut-Sync] Syncing transactions for account ${account.id} (tenant ${account.tenantId})...`
				);

				const result = await syncRevolutTransactionsForAccount(
					account.tenantId,
					account.id,
					2 // 2 days
				);

				accountsProcessed++;
				totalTransactionsSynced += result.transactionsSynced;

				console.log(
					`[Revolut-Sync] Account ${account.id}: ${result.transactionsSynced} transactions synced`
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(
					`[Revolut-Sync] Error syncing transactions for account ${account.id}:`,
					errorMessage
				);
				errors.push({
					accountId: account.id,
					tenantId: account.tenantId,
					error: errorMessage
				});
				// Continue with other accounts
			}
		}

		console.log(
			`[Revolut-Sync] Completed: ${accountsProcessed} accounts processed, ${totalTransactionsSynced} transactions synced`
		);

		return {
			success: true,
			accountsProcessed,
			totalTransactionsSynced,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		console.error('[Revolut-Sync] Process error:', error);
		return {
			success: false,
			accountsProcessed: 0,
			totalTransactionsSynced: 0,
			error: 'Failed to process Revolut transaction sync'
		};
	}
}
