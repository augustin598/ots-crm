import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const getPlugins = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Get all plugins
	const plugins = await db.select().from(table.plugin).where(eq(table.plugin.isActive, true));

	// Get tenant-specific plugin configurations
	const tenantPlugins = await db
		.select({
			pluginId: table.tenantPlugin.pluginId,
			isActive: table.tenantPlugin.isActive,
			config: table.tenantPlugin.config
		})
		.from(table.tenantPlugin)
		.where(eq(table.tenantPlugin.tenantId, event.locals.tenant.id));

	// Map plugins with tenant-specific status
	return plugins.map((plugin) => {
		const tenantPlugin = tenantPlugins.find((tp) => tp.pluginId === plugin.id);
		return {
			...plugin,
			enabled: tenantPlugin?.isActive ?? false,
			tenantConfig: tenantPlugin?.config || {}
		};
	});
});

export const enablePlugin = command(
	v.pipe(v.string(), v.minLength(1)),
	async (pluginId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can enable plugins
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Check if plugin exists
		const [plugin] = await db.select().from(table.plugin).where(eq(table.plugin.id, pluginId)).limit(1);

		if (!plugin) {
			throw new Error('Plugin not found');
		}

		// Check if tenant plugin already exists
		const [existing] = await db
			.select()
			.from(table.tenantPlugin)
			.where(
				and(
					eq(table.tenantPlugin.tenantId, event.locals.tenant.id),
					eq(table.tenantPlugin.pluginId, pluginId)
				)
			)
			.limit(1);

		if (existing) {
			// Update existing
			await db
				.update(table.tenantPlugin)
				.set({
					isActive: true,
					updatedAt: new Date()
				})
				.where(eq(table.tenantPlugin.id, existing.id));
		} else {
			// Create new tenant plugin
			const tenantPluginId = crypto.randomUUID();
			await db.insert(table.tenantPlugin).values({
				id: tenantPluginId,
				tenantId: event.locals.tenant.id,
				pluginId,
				isActive: true
			});
		}

		return { success: true };
	}
);

export const disablePlugin = command(
	v.pipe(v.string(), v.minLength(1)),
	async (pluginId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can disable plugins
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Update tenant plugin
		await db
			.update(table.tenantPlugin)
			.set({
				isActive: false,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(table.tenantPlugin.tenantId, event.locals.tenant.id),
					eq(table.tenantPlugin.pluginId, pluginId)
				)
			);

		return { success: true };
	}
);
