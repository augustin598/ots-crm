import type { Plugin, PluginConfig, HooksManager } from '../types';
import { onInvoiceCreated, onInvoiceUpdated } from './hooks';

export class SmartBillPlugin implements Plugin {
	id = 'smartbill';
	name = 'smartbill';
	version = '1.0.0';
	displayName = 'SmartBill Integration';
	description = 'Integrate with SmartBill for invoice management and syncing';

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
		console.log(`[SmartBill] Plugin enabled for tenant ${tenantId}`);
	}

	async onDisable(tenantId: string): Promise<void> {
		// Called when plugin is disabled for a tenant
		console.log(`[SmartBill] Plugin disabled for tenant ${tenantId}`);
	}
}

// Export singleton instance
export const smartBillPlugin = new SmartBillPlugin();
