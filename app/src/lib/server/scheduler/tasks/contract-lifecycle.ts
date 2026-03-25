import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { recordContractActivity } from '../../contract-activity';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Process contract lifecycle transitions:
 * 1. Auto-activate: signed contracts where contractDate <= now
 * 2. Auto-expire: active contracts where contractDate + durationMonths <= now
 */
export async function processContractLifecycle(params: Record<string, any> = {}) {
	try {
		const now = new Date();
		let activated = 0;
		let expired = 0;
		const errors: Array<{ id: string; error: string }> = [];

		// Select only needed columns for lifecycle processing
		const lifecycleColumns = {
			id: table.contract.id,
			tenantId: table.contract.tenantId,
			version: table.contract.version,
			contractDate: table.contract.contractDate,
			contractDurationMonths: table.contract.contractDurationMonths
		};

		// 1. Auto-activate: signed contracts where contractDate has been reached
		const signedContracts = await db
			.select(lifecycleColumns)
			.from(table.contract)
			.where(
				and(
					eq(table.contract.status, 'signed'),
					lte(table.contract.contractDate, now)
				)
			);

		for (const contract of signedContracts) {
			try {
				await db
					.update(table.contract)
					.set({
						status: 'active',
						version: contract.version + 1,
						updatedAt: now
					})
					.where(eq(table.contract.id, contract.id));

				await recordContractActivity({
					contractId: contract.id,
					userId: 'system',
					tenantId: contract.tenantId,
					action: 'status_changed',
					field: 'status',
					oldValue: 'signed',
					newValue: 'active'
				});
				activated++;
			} catch (err) {
				errors.push({ id: contract.id, error: String(err) });
			}
		}

		// 2. Auto-expire: active contracts where contractDate + durationMonths has passed
		// Filter expired contracts in SQL using date arithmetic
		const activeContracts = await db
			.select(lifecycleColumns)
			.from(table.contract)
			.where(
				and(
					eq(table.contract.status, 'active'),
					sql`date(${table.contract.contractDate}, '+' || ${table.contract.contractDurationMonths} || ' months') <= date('now')`
				)
			);

		for (const contract of activeContracts) {
			try {
				await db
					.update(table.contract)
					.set({
						status: 'expired',
						version: contract.version + 1,
						updatedAt: now
					})
					.where(eq(table.contract.id, contract.id));

				await recordContractActivity({
					contractId: contract.id,
					userId: 'system',
					tenantId: contract.tenantId,
					action: 'status_changed',
					field: 'status',
					oldValue: 'active',
					newValue: 'expired'
				});
				expired++;
			} catch (err) {
				errors.push({ id: contract.id, error: String(err) });
			}
		}

		logInfo('scheduler', `Contract lifecycle completed: ${activated} activated, ${expired} expired`, { metadata: { activated, expired } });
		return {
			success: true,
			activated,
			expired,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Contract lifecycle: process error: ${message}`, { stackTrace: stack });
		return { success: false, activated: 0, expired: 0, error: message };
	}
}
