import type { Plugin, PluginConfig } from './types';
import { getPluginRegistry } from './registry';
import { getHooksManager } from './hooks';

/**
 * Plugin manager for lifecycle management
 */
class PluginManager {
	/**
	 * Initialize a plugin
	 */
	async initializePlugin(plugin: Plugin, config?: PluginConfig): Promise<void> {
		try {
			await plugin.initialize(config || {});
		} catch (error) {
			console.error(`[PluginManager] Failed to initialize plugin ${plugin.id}:`, error);
			throw error;
		}
	}

	/**
	 * Register hooks for a plugin
	 */
	registerPluginHooks(plugin: Plugin): void {
		const hooks = getHooksManager();
		try {
			plugin.registerHooks(hooks);
		} catch (error) {
			console.error(`[PluginManager] Failed to register hooks for plugin ${plugin.id}:`, error);
			throw error;
		}
	}

	/**
	 * Enable a plugin for a tenant
	 */
	async enablePluginForTenant(plugin: Plugin, tenantId: string): Promise<void> {
		try {
			await plugin.onEnable(tenantId);
		} catch (error) {
			console.error(`[PluginManager] Failed to enable plugin ${plugin.id} for tenant ${tenantId}:`, error);
			throw error;
		}
	}

	/**
	 * Disable a plugin for a tenant
	 */
	async disablePluginForTenant(plugin: Plugin, tenantId: string): Promise<void> {
		try {
			await plugin.onDisable(tenantId);
		} catch (error) {
			console.error(`[PluginManager] Failed to disable plugin ${plugin.id} for tenant ${tenantId}:`, error);
			throw error;
		}
	}

	/**
	 * Load and initialize all plugins
	 */
	async loadPlugins(): Promise<void> {
		const registry = getPluginRegistry();
		const plugins = registry.getAll();

		for (const plugin of plugins) {
			try {
				await this.initializePlugin(plugin);
				this.registerPluginHooks(plugin);
			} catch (error) {
				console.error(`[PluginManager] Failed to load plugin ${plugin.id}:`, error);
				// Continue loading other plugins
			}
		}
	}
}

// Singleton instance
let managerInstance: PluginManager | null = null;

/**
 * Get the global plugin manager instance
 */
export function getPluginManager(): PluginManager {
	if (!managerInstance) {
		managerInstance = new PluginManager();
	}
	return managerInstance;
}

/**
 * Reset the plugin manager (useful for testing)
 */
export function resetPluginManager(): void {
	managerInstance = null;
}
