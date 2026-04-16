import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lte, or, sql } from 'drizzle-orm';
import { recordContractActivity } from '../../contract-activity';
import { getHooksManager } from '../../plugins/hooks';
import { createNotification } from '../../notifications';
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

		const hooks = getHooksManager();

		// Select only needed columns for lifecycle processing
		const lifecycleColumns = {
			id: table.contract.id,
			tenantId: table.contract.tenantId,
			clientId: table.contract.clientId,
			contractTitle: table.contract.contractTitle,
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
				// Optimistic lock: only update if version hasn't changed (prevents overwriting concurrent admin edits)
				const result = await db
					.update(table.contract)
					.set({
						status: 'active',
						version: contract.version + 1,
						updatedAt: now
					})
					.where(and(eq(table.contract.id, contract.id), eq(table.contract.version, contract.version)));

				if ((result as any)?.rowsAffected === 0) {
					logInfo('scheduler', `Contract lifecycle: skipped activation for ${contract.id} — concurrent modification`, { tenantId: contract.tenantId });
					continue;
				}

				await recordContractActivity({
					contractId: contract.id,
					userId: 'system',
					tenantId: contract.tenantId,
					action: 'status_changed',
					field: 'status',
					oldValue: 'signed',
					newValue: 'active'
				});

				// Get tenant slug for notification link
				if (contract.clientId) {
					const [tenant] = await db
						.select({ slug: table.tenant.slug })
						.from(table.tenant)
						.where(eq(table.tenant.id, contract.tenantId))
						.limit(1);
					if (tenant) {
						await hooks.emit({
							type: 'contract.activated',
							contractId: contract.id,
							contractTitle: contract.contractTitle || 'Fără titlu',
							clientId: contract.clientId,
							tenantId: contract.tenantId,
							tenantSlug: tenant.slug
						});
					}
				}

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
				// Optimistic lock: only update if version hasn't changed
				const result = await db
					.update(table.contract)
					.set({
						status: 'expired',
						version: contract.version + 1,
						updatedAt: now
					})
					.where(and(eq(table.contract.id, contract.id), eq(table.contract.version, contract.version)));

				if ((result as any)?.rowsAffected === 0) {
					logInfo('scheduler', `Contract lifecycle: skipped expiration for ${contract.id} — concurrent modification`, { tenantId: contract.tenantId });
					continue;
				}

				await recordContractActivity({
					contractId: contract.id,
					userId: 'system',
					tenantId: contract.tenantId,
					action: 'status_changed',
					field: 'status',
					oldValue: 'active',
					newValue: 'expired'
				});

				if (contract.clientId) {
					const [tenant] = await db
						.select({ slug: table.tenant.slug })
						.from(table.tenant)
						.where(eq(table.tenant.id, contract.tenantId))
						.limit(1);
					if (tenant) {
						await hooks.emit({
							type: 'contract.expired',
							contractId: contract.id,
							contractTitle: contract.contractTitle || 'Fără titlu',
							clientId: contract.clientId,
							tenantId: contract.tenantId,
							tenantSlug: tenant.slug
						});
					}
				}

				expired++;
			} catch (err) {
				errors.push({ id: contract.id, error: String(err) });
			}
		}

		// 3. Warn about contracts expiring within 14 days
		let expiringWarned = 0;
		try {
			const expiringContracts = await db
				.select({
					id: table.contract.id,
					tenantId: table.contract.tenantId,
					clientId: table.contract.clientId,
					contractTitle: table.contract.contractTitle,
				})
				.from(table.contract)
				.where(
					and(
						eq(table.contract.status, 'active'),
						// Expiry date is within 14 days but hasn't passed yet
						sql`date(${table.contract.contractDate}, '+' || ${table.contract.contractDurationMonths} || ' months') > date('now')`,
						sql`date(${table.contract.contractDate}, '+' || ${table.contract.contractDurationMonths} || ' months') <= date('now', '+14 days')`
					)
				);

			if (expiringContracts.length > 0) {
				// Group by tenant
				const byTenant = new Map<string, typeof expiringContracts>();
				for (const c of expiringContracts) {
					const list = byTenant.get(c.tenantId) ?? [];
					list.push(c);
					byTenant.set(c.tenantId, list);
				}

				for (const [tenantId, contracts] of byTenant) {
					const adminUsers = await db
						.select({ userId: table.tenantUser.userId })
						.from(table.tenantUser)
						.where(
							and(
								eq(table.tenantUser.tenantId, tenantId),
								or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
							)
						);

					const [tenant] = await db
						.select({ slug: table.tenant.slug })
						.from(table.tenant)
						.where(eq(table.tenant.id, tenantId))
						.limit(1);

					for (const { userId } of adminUsers) {
						await createNotification({
							tenantId,
							userId,
							type: 'contract.expiring',
							title: `${contracts.length} contracte expira curand`,
							message: contracts.length === 1
								? `Contractul "${contracts[0].contractTitle || 'Fara titlu'}" expira in mai putin de 14 zile`
								: `${contracts.length} contracte expira in mai putin de 14 zile`,
							link: tenant ? `/${tenant.slug}/contracts` : undefined,
							priority: 'high',
						});
					}

					expiringWarned += contracts.length;
				}
			}
		} catch (err) {
			logError('scheduler', `Contract lifecycle: expiring check failed: ${err instanceof Error ? err.message : String(err)}`);
		}

		logInfo('scheduler', `Contract lifecycle completed: ${activated} activated, ${expired} expired, ${expiringWarned} expiring warnings`, { metadata: { activated, expired, expiringWarned } });
		return {
			success: true,
			activated,
			expired,
			expiringWarned,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Contract lifecycle: process error: ${message}`, { stackTrace: stack });
		return { success: false, activated: 0, expired: 0, error: message };
	}
}
