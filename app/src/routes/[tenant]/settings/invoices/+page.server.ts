import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		return {
			activePlugins: []
		};
	}

	// Get active plugins for this tenant (only SmartBill and Keez)
	const activePlugins = await db
		.select({
			pluginId: table.tenantPlugin.pluginId,
			pluginName: table.plugin.name
		})
		.from(table.tenantPlugin)
		.innerJoin(table.plugin, eq(table.plugin.id, table.tenantPlugin.pluginId))
		.where(
			and(
				eq(table.tenantPlugin.tenantId, event.locals.tenant.id),
				eq(table.tenantPlugin.isActive, true),
				eq(table.plugin.isActive, true)
			)
		);

	// Filter to only SmartBill and Keez plugins
	const invoicePlugins = activePlugins
		.filter((p) => p.pluginName === 'smartbill' || p.pluginName === 'keez')
		.map((p) => p.pluginName);

	return {
		activePlugins: invoicePlugins
	};
};
