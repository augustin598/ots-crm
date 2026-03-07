import { getPluginRegistry } from './registry';
import { getPluginManager } from './manager';
import { smartBillPlugin } from './smartbill/plugin';
import { keezPlugin } from './keez/plugin';
import { anafSpvPlugin } from './anaf-spv/plugin';
import { bankingRevolutPlugin } from './banking/revolut/plugin';
import { bankingTransilvaniaPlugin } from './banking/transilvania/plugin';
import { bankingBCRPlugin } from './banking/bcr/plugin';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Initialize and register all plugins
 */
export async function initializePlugins(): Promise<void> {
	const registry = getPluginRegistry();
	const manager = getPluginManager();

	// Register SmartBill plugin
	registry.register(smartBillPlugin);

	// Register Keez plugin
	registry.register(keezPlugin);

	// Register ANAF SPV plugin
	registry.register(anafSpvPlugin);

	// Register Banking plugins
	registry.register(bankingRevolutPlugin);
	registry.register(bankingTransilvaniaPlugin);
	registry.register(bankingBCRPlugin);

	// Load plugin from database and ensure plugins are registered
	await ensureSmartBillPluginInDatabase();
	await ensureKeezPluginInDatabase();
	await ensureAnafSpvPluginInDatabase();
	await ensureBankingPluginsInDatabase();

	// Initialize all registered plugins
	await manager.loadPlugins();
}

/**
 * Ensure SmartBill plugin exists in database
 */
async function ensureSmartBillPluginInDatabase(): Promise<void> {
	try {
		const [existing] = await db
			.select()
			.from(table.plugin)
			.where(eq(table.plugin.name, 'smartbill'))
			.limit(1);

		if (!existing) {
			const pluginId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.plugin).values({
				id: pluginId,
				name: 'smartbill',
				displayName: 'SmartBill Integration',
				description: 'Integrate with SmartBill for invoice management and syncing',
				version: '1.0.0',
				isActive: true,
				config: {}
			});
			logInfo('plugin', 'Created SmartBill plugin in database');
		}
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('plugin', `Failed to ensure SmartBill plugin: ${message}`, { stackTrace: stack });
		// Don't throw - allow app to continue
	}
}

/**
 * Ensure Keez plugin exists in database
 */
async function ensureKeezPluginInDatabase(): Promise<void> {
	try {
		const [existing] = await db
			.select()
			.from(table.plugin)
			.where(eq(table.plugin.name, 'keez'))
			.limit(1);

		if (!existing) {
			const pluginId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.plugin).values({
				id: pluginId,
				name: 'keez',
				displayName: 'Keez Integration',
				description: 'Integrate with Keez for invoice management and syncing',
				version: '1.0.0',
				isActive: true,
				config: {}
			});
			logInfo('plugin', 'Created Keez plugin in database');
		}
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('plugin', `Failed to ensure Keez plugin: ${message}`, { stackTrace: stack });
		// Don't throw - allow app to continue
	}
}

/**
 * Ensure ANAF SPV plugin exists in database
 */
async function ensureAnafSpvPluginInDatabase(): Promise<void> {
	try {
		const [existing] = await db
			.select()
			.from(table.plugin)
			.where(eq(table.plugin.name, 'anaf-spv'))
			.limit(1);

		if (!existing) {
			const pluginId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.plugin).values({
				id: pluginId,
				name: 'anaf-spv',
				displayName: 'ANAF SPV Integration',
				description: 'Integrate with ANAF SPV (Sistemul Privat Virtual) for Romanian e-factura management and syncing',
				version: '1.0.0',
				isActive: true,
				config: {}
			});
			logInfo('plugin', 'Created ANAF SPV plugin in database');
		}
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('plugin', `Failed to ensure ANAF SPV plugin: ${message}`, { stackTrace: stack });
		// Don't throw - allow app to continue
	}
}

/**
 * Ensure Banking plugins exist in database
 */
async function ensureBankingPluginsInDatabase(): Promise<void> {
	const plugins = [
		{
			name: 'banking-revolut',
			displayName: 'Revolut Banking Integration',
			description: 'Connect and sync transactions from Revolut bank accounts',
			version: '1.0.0'
		},
		{
			name: 'banking-transilvania',
			displayName: 'Banca Transilvania Banking Integration',
			description: 'Connect and sync transactions from Banca Transilvania bank accounts',
			version: '1.0.0'
		},
		{
			name: 'banking-bcr',
			displayName: 'BCR Banking Integration',
			description: 'Connect and sync transactions from BCR (Banca Comercială Română) bank accounts',
			version: '1.0.0'
		}
	];

	for (const pluginData of plugins) {
		try {
			const [existing] = await db
				.select()
				.from(table.plugin)
				.where(eq(table.plugin.name, pluginData.name))
				.limit(1);

			if (!existing) {
				const pluginId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				await db.insert(table.plugin).values({
					id: pluginId,
					name: pluginData.name,
					displayName: pluginData.displayName,
					description: pluginData.description,
					version: pluginData.version,
					isActive: true,
					config: {}
				});
				logInfo('plugin', `Created ${pluginData.name} plugin in database`);
			}
		} catch (error) {
			const { message, stack } = serializeError(error);
			logError('plugin', `Failed to ensure ${pluginData.name} plugin: ${message}`, { stackTrace: stack });
			// Don't throw - allow app to continue
		}
	}
}
