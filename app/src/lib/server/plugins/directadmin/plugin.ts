import type { Plugin, PluginConfig, HooksManager } from '../types';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { onInvoiceStatusChanged, onInvoicePaid } from './hooks';

export class DirectAdminPlugin implements Plugin {
	id = 'directadmin';
	name = 'directadmin';
	version = '1.0.0';
	displayName = 'DirectAdmin Hosting';
	description =
		'Manage DirectAdmin servers, packages and hosting accounts; auto-suspend on overdue invoices.';

	async initialize(_config: PluginConfig): Promise<void> {
		// No-op. Configuration is per-server (in daServer table), not global.
	}

	registerHooks(hooks: HooksManager): void {
		hooks.on('invoice.status.changed', onInvoiceStatusChanged, this.id);
		hooks.on('invoice.paid', onInvoicePaid, this.id);
	}

	async onEnable(tenantId: string): Promise<void> {
		logInfo('directadmin', 'Plugin enabled for tenant', { tenantId });
	}

	/**
	 * Disable safety: refuse if there are auto-suspended hosting accounts.
	 * The UI should call a separate "force disable" path to unsuspend everything first.
	 */
	async onDisable(tenantId: string): Promise<void> {
		try {
			const rows = await db
				.select({ id: table.hostingAccount.id })
				.from(table.hostingAccount)
				.where(
					and(
						eq(table.hostingAccount.tenantId, tenantId),
						eq(table.hostingAccount.status, 'suspended'),
						like(table.hostingAccount.suspendReason, 'Overdue invoice%')
					)
				);
			if (rows.length > 0) {
				logError(
					'directadmin',
					`refusing to disable plugin: ${rows.length} auto-suspended account(s) remain. Reactivate them first via the UI.`,
					{ tenantId, metadata: { suspendedCount: rows.length } }
				);
				throw new Error(
					`Cannot disable DirectAdmin plugin: ${rows.length} account(s) are auto-suspended due to overdue invoices. Resolve them first.`
				);
			}
			logInfo('directadmin', 'Plugin disabled for tenant', { tenantId });
		} catch (e) {
			if (e instanceof Error && e.message.includes('Cannot disable')) throw e;
			const { message, stack } = serializeError(e);
			logError('directadmin', `onDisable check failed: ${message}`, { tenantId, stackTrace: stack });
		}
	}
}

export const directAdminPlugin = new DirectAdminPlugin();
