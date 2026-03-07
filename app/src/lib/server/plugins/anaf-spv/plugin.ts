import type { Plugin, PluginConfig, HooksManager } from '../types';
import { onInvoiceCreated, onInvoiceUpdated } from './hooks';
import { logInfo } from '$lib/server/logger';

export class AnafSpvPlugin implements Plugin {
	id = 'anaf-spv';
	name = 'anaf-spv';
	version = '1.0.0';
	displayName = 'ANAF SPV Integration';
	description = 'Integrate with ANAF SPV (Sistemul Privat Virtual) for Romanian e-factura management and syncing';

	async initialize(config: PluginConfig): Promise<void> {
		// Plugin initialization logic
		// Can be used to validate configuration, set up resources, etc.
	}

	registerHooks(hooks: HooksManager): void {
		// Register hook handlers
		hooks.on('invoice.created', onInvoiceCreated);
		hooks.on('invoice.updated', onInvoiceUpdated);
	}

	async onEnable(tenantId: string): Promise<void> {
		// Called when plugin is enabled for a tenant
		logInfo('anaf-spv', 'Plugin enabled', { tenantId });
	}

	async onDisable(tenantId: string): Promise<void> {
		// Called when plugin is disabled for a tenant
		logInfo('anaf-spv', 'Plugin disabled', { tenantId });
	}
}

// Export singleton instance
export const anafSpvPlugin = new AnafSpvPlugin();
