import type { Plugin, PluginConfig } from './types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Plugin registry
 */
class PluginRegistry {
	private plugins: Map<string, Plugin> = new Map();

	/**
	 * Register a plugin
	 */
	register(plugin: Plugin): void {
		if (this.plugins.has(plugin.id)) {
			logWarning('plugin', `Plugin ${plugin.id} is already registered`);
		} else {
			this.plugins.set(plugin.id, plugin);
		}
	}

	/**
	 * Get a plugin by ID
	 */
	get(pluginId: string): Plugin | undefined {
		return this.plugins.get(pluginId);
	}

	/**
	 * Get all registered plugins
	 */
	getAll(): Plugin[] {
		return Array.from(this.plugins.values());
	}

	/**
	 * Check if a plugin is registered
	 */
	has(pluginId: string): boolean {
		return this.plugins.has(pluginId);
	}

	/**
	 * Get active plugins for a tenant
	 */
	async getActivePluginsForTenant(tenantId: string): Promise<Plugin[]> {
		const tenantPlugins = await db
			.select({
				pluginId: table.tenantPlugin.pluginId,
				isActive: table.tenantPlugin.isActive,
				config: table.tenantPlugin.config
			})
			.from(table.tenantPlugin)
			.innerJoin(table.plugin, eq(table.plugin.id, table.tenantPlugin.pluginId))
			.where(
				and(
					eq(table.tenantPlugin.tenantId, tenantId),
					eq(table.tenantPlugin.isActive, true),
					eq(table.plugin.isActive, true)
				)
			);

		const activePlugins: Plugin[] = [];

		for (const tenantPlugin of tenantPlugins) {
			const plugin = this.plugins.get(tenantPlugin.pluginId);
			if (plugin) {
				// Initialize plugin with tenant-specific config if needed
				if (tenantPlugin.config) {
					try {
						await plugin.initialize(tenantPlugin.config as PluginConfig);
					} catch (error) {
						const { message, stack } = serializeError(error);
					logError('plugin', `Failed to initialize plugin ${plugin.id}: ${message}`, { tenantId, stackTrace: stack });
						continue;
					}
				}
				activePlugins.push(plugin);
			}
		}

		return activePlugins;
	}

	/**
	 * Check if a plugin is active for a tenant. Accepts the plugin's logical name
	 * (e.g. 'directadmin', 'keez') — NOT the DB row id, which is base32 garbage.
	 *
	 * Bug history: previously matched against `tenantPlugin.pluginId` directly, which
	 * stores the DB row id. All callers pass the plugin name, so this always returned
	 * false — silently disabling DA hooks. Fix: match `plugin.name` via the join.
	 */
	async isPluginActiveForTenant(tenantId: string, pluginName: string): Promise<boolean> {
		const [result] = await db
			.select({ id: table.tenantPlugin.id })
			.from(table.tenantPlugin)
			.innerJoin(table.plugin, eq(table.plugin.id, table.tenantPlugin.pluginId))
			.where(
				and(
					eq(table.tenantPlugin.tenantId, tenantId),
					eq(table.plugin.name, pluginName),
					eq(table.tenantPlugin.isActive, true),
					eq(table.plugin.isActive, true)
				)
			)
			.limit(1);

		return !!result;
	}
}

// Singleton instance
let registryInstance: PluginRegistry | null = null;

/**
 * Get the global plugin registry instance
 */
export function getPluginRegistry(): PluginRegistry {
	if (!registryInstance) {
		registryInstance = new PluginRegistry();
	}
	return registryInstance;
}

/**
 * Reset the plugin registry (useful for testing)
 */
export function resetPluginRegistry(): void {
	registryInstance = null;
}
