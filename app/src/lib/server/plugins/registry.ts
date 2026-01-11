import type { Plugin, PluginConfig } from './types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

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
			console.warn(`Plugin ${plugin.id} is already registered`);
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
						console.error(`[PluginRegistry] Failed to initialize plugin ${plugin.id}:`, error);
						continue;
					}
				}
				activePlugins.push(plugin);
			}
		}

		return activePlugins;
	}

	/**
	 * Check if a plugin is active for a tenant
	 */
	async isPluginActiveForTenant(tenantId: string, pluginId: string): Promise<boolean> {
		const [result] = await db
			.select()
			.from(table.tenantPlugin)
			.innerJoin(table.plugin, eq(table.plugin.id, table.tenantPlugin.pluginId))
			.where(
				and(
					eq(table.tenantPlugin.tenantId, tenantId),
					eq(table.tenantPlugin.pluginId, pluginId),
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
