import type { Plugin, PluginConfig, HooksManager } from '../types';
import { onInvoiceCreated, onInvoiceUpdated, onInvoiceDeleted, onInvoicePaid } from './hooks';
import { logInfo } from '$lib/server/logger';

export class KeezPlugin implements Plugin {
	id = 'keez';
	name = 'keez';
	version = '1.0.0';
	displayName = 'Keez Integration';
	description = 'Integrate with Keez for invoice management and syncing';

	async initialize(config: PluginConfig): Promise<void> {
		// Plugin initialization logic
		// Can be used to validate configuration, set up resources, etc.
	}

	registerHooks(hooks: HooksManager): void {
		// Register hook handlers
		hooks.on('invoice.created', onInvoiceCreated);
		hooks.on('invoice.updated', onInvoiceUpdated);
		hooks.on('invoice.deleted', onInvoiceDeleted);
		// Proformă → fiscală DOAR la încasare (hosting): vezi auto-validate-policy.ts
		hooks.on('invoice.paid', onInvoicePaid);
	}

	async onEnable(tenantId: string): Promise<void> {
		// Called when plugin is enabled for a tenant
		logInfo('keez', 'Plugin enabled', { tenantId });
	}

	async onDisable(tenantId: string): Promise<void> {
		// Called when plugin is disabled for a tenant
		logInfo('keez', 'Plugin disabled', { tenantId });
	}
}

// Export singleton instance
export const keezPlugin = new KeezPlugin();
