import type { Plugin, PluginConfig } from './types';
import { getPluginRegistry } from './registry';
import { getHooksManager } from './hooks';
import { logError, serializeError } from '$lib/server/logger';

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
			const { message, stack } = serializeError(error);
			logError('plugin', `Failed to initialize plugin ${plugin.id}: ${message}`, { stackTrace: stack });
			throw error;
		}
	}

	/**
	 * Register hooks for a plugin
	 * Clears existing handlers for the plugin before registering new ones to prevent duplicates
	 */
	registerPluginHooks(plugin: Plugin): void {
		const hooks = getHooksManager();
		try {
			// Clear existing handlers for this plugin to prevent duplicates in development/hot reload
			hooks.clearPluginHandlers(plugin.id);

			// Create a wrapper that passes plugin ID to the hooks manager
			const hooksWithPluginId: HooksManager = {
				on: (eventType, handler) => hooks.on(eventType, handler, plugin.id),
				emit: (event) => hooks.emit(event),
				off: (eventType, handler) => hooks.off(eventType, handler),
				clearPluginHandlers: (pluginId) => hooks.clearPluginHandlers(pluginId)
			};

			plugin.registerHooks(hooksWithPluginId);
		} catch (error) {
			const { message, stack } = serializeError(error);
			logError('plugin', `Failed to register hooks for plugin ${plugin.id}: ${message}`, { stackTrace: stack });
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
			const { message, stack } = serializeError(error);
			logError('plugin', `Failed to enable plugin ${plugin.id}: ${message}`, { tenantId, stackTrace: stack });
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
			const { message, stack } = serializeError(error);
			logError('plugin', `Failed to disable plugin ${plugin.id}: ${message}`, { tenantId, stackTrace: stack });
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
				const { message, stack } = serializeError(error);
				logError('plugin', `Failed to load plugin ${plugin.id}: ${message}`, { stackTrace: stack });
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
