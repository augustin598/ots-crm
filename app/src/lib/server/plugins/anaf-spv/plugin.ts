import type { Plugin, PluginConfig, HooksManager } from '../types';
import { onInvoiceCreated, onInvoiceUpdated } from './hooks';

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
		console.log(`[ANAF-SPV] Plugin enabled for tenant ${tenantId}`);
	}

	async onDisable(tenantId: string): Promise<void> {
		// Called when plugin is disabled for a tenant
		console.log(`[ANAF-SPV] Plugin disabled for tenant ${tenantId}`);
	}
}

// Export singleton instance
export const anafSpvPlugin = new AnafSpvPlugin();
