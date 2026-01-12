import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { KeezClient } from '$lib/server/plugins/keez/client';
import { encrypt, decrypt } from '$lib/server/plugins/keez/crypto';
import {
	mapInvoiceToKeez,
	mapKeezInvoiceToCRM,
	mapKeezPartnerToClient,
	mapKeezDetailsToLineItems
} from '$lib/server/plugins/keez/mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateIntegrationId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const connectKeez = command(
	v.object({
		clientEid: v.pipe(v.string(), v.minLength(1)),
		applicationId: v.pipe(v.string(), v.minLength(1)),
		secret: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can connect Keez
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Test connection
		const client = new KeezClient({
			clientEid: data.clientEid,
			applicationId: data.applicationId,
			secret: data.secret
		});

		// Test API call by getting access token
		try {
			await client.getAccessToken();
		} catch (error) {
			console.error('Failed to connect to Keez:', error);
			throw new Error(
				`Failed to connect to Keez: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		// Encrypt secret
		const encryptedSecret = encrypt(event.locals.tenant.id, data.secret);

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.keezIntegration)
			.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing integration
			await db
				.update(table.keezIntegration)
				.set({
					clientEid: data.clientEid,
					applicationId: data.applicationId,
					secret: encryptedSecret,
					isActive: true,
					updatedAt: new Date()
				})
				.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));
		} else {
			// Create new integration
			const integrationId = generateIntegrationId();
			await db.insert(table.keezIntegration).values({
				id: integrationId,
				tenantId: event.locals.tenant.id,
				clientEid: data.clientEid,
				applicationId: data.applicationId,
				secret: encryptedSecret,
				isActive: true
			});
		}

		return { success: true };
	}
);

export const disconnectKeez = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can disconnect Keez
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	await db
		.update(table.keezIntegration)
		.set({
			isActive: false,
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));

	return { success: true };
});

export const getKeezStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [integration] = await db
		.select({
			clientEid: table.keezIntegration.clientEid,
			applicationId: table.keezIntegration.applicationId,
			isActive: table.keezIntegration.isActive,
			lastSyncAt: table.keezIntegration.lastSyncAt
		})
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!integration) {
		return {
			connected: false,
			isActive: false
		};
	}

	return {
		connected: true,
		isActive: integration.isActive,
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		lastSyncAt: integration.lastSyncAt
	};
});

export const syncInvoiceToKeez = command(v.pipe(v.string(), v.minLength(1)), async (invoiceId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Get invoice
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get integration
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(
				eq(table.keezIntegration.tenantId, event.locals.tenant.id),
				eq(table.keezIntegration.isActive, true)
			)
		)
		.limit(1);

	if (!integration) {
		throw new Error('Keez integration not connected');
	}

	// Get tenant and client
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, event.locals.tenant.id))
		.limit(1);
	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!tenant || !client) {
		throw new Error('Tenant or client not found');
	}

	// Get line items
	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

	// Decrypt secret
	const secret = decrypt(event.locals.tenant.id, integration.secret);

	// Create Keez client
	const keezClient = new KeezClient({
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		secret
	});

	// Use existing external ID or generate one
	const externalId = invoice.keezExternalId || invoice.id;

	// Map and create invoice
	const keezInvoice = mapInvoiceToKeez({ ...invoice, lineItems }, client, tenant, externalId);

	const response = await keezClient.createInvoice(keezInvoice);

	// Update invoice
	await db
		.update(table.invoice)
		.set({
			keezInvoiceId: response.externalId,
			keezExternalId: response.externalId,
			updatedAt: new Date()
		})
		.where(eq(table.invoice.id, invoiceId));

	// Create/update sync record
	const [existingSync] = await db
		.select()
		.from(table.keezInvoiceSync)
		.where(eq(table.keezInvoiceSync.invoiceId, invoiceId))
		.limit(1);

	if (existingSync) {
		await db
			.update(table.keezInvoiceSync)
			.set({
				keezInvoiceId: response.externalId,
				keezExternalId: response.externalId,
				syncStatus: 'synced',
				lastSyncedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.keezInvoiceSync.id, existingSync.id));
	} else {
		const syncId = generateSyncId();
		await db.insert(table.keezInvoiceSync).values({
			id: syncId,
			invoiceId,
			tenantId: event.locals.tenant.id,
			keezInvoiceId: response.externalId,
			keezExternalId: response.externalId,
			syncDirection: 'push',
			syncStatus: 'synced',
			lastSyncedAt: new Date()
		});
	}

	// Update integration last sync time
	await db
		.update(table.keezIntegration)
		.set({
			lastSyncAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));

	return { success: true, externalId: response.externalId };
});

export const syncInvoicesFromKeez = command(
	v.object({
		offset: v.optional(v.number()),
		count: v.optional(v.number()),
		filter: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Get invoices from Keez
		const response = await keezClient.getInvoices({
			offset: filters.offset,
			count: filters.count || 100,
			filter: filters.filter
		});

		let imported = 0;
		let skipped = 0;

		// Import each invoice
		for (const invoiceHeader of response.data || []) {
			try {
				// Check if invoice already exists
				const [existing] = await db
					.select()
					.from(table.invoice)
					.where(eq(table.invoice.keezExternalId, invoiceHeader.externalId))
					.limit(1);

				if (existing) {
					skipped++;
					continue;
				}

				// Get full invoice details
				const keezInvoice = await keezClient.getInvoice(invoiceHeader.externalId);

				// Find or create client
				let clientId: string | null = null;
				if (keezInvoice.partner?.partnerName) {
					const [existingClient] = await db
						.select()
						.from(table.client)
						.where(
							and(
								eq(table.client.name, keezInvoice.partner.partnerName),
								eq(table.client.tenantId, event.locals.tenant.id)
							)
						)
						.limit(1);

					if (existingClient) {
						clientId = existingClient.id;
					} else if (keezInvoice.partner) {
						// Create new client
						const newClientId = generateClientId();
						const clientData = mapKeezPartnerToClient(keezInvoice.partner, event.locals.tenant.id);
						await db.insert(table.client).values({
							id: newClientId,
							...clientData
						});
						clientId = newClientId;
					}
				}

				if (!clientId) {
					skipped++;
					continue; // Skip if no client
				}

				// Map invoice to CRM format
				const invoiceData = mapKeezInvoiceToCRM(
					keezInvoice,
					invoiceHeader,
					event.locals.tenant.id,
					clientId,
					event.locals.user.id
				);

				// Create invoice
				const invoiceId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				await db.insert(table.invoice).values({
					id: invoiceId,
					...invoiceData
				});

				// Create line items
				if (invoiceData.lineItems && invoiceData.lineItems.length > 0) {
					const lineItems = invoiceData.lineItems.map((item) => ({
						...item,
						invoiceId,
						id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)))
					}));
					await db.insert(table.invoiceLineItem).values(lineItems);
				}

				// Create sync record
				const syncId = generateSyncId();
				await db.insert(table.keezInvoiceSync).values({
					id: syncId,
					invoiceId,
					tenantId: event.locals.tenant.id,
					keezInvoiceId: invoiceHeader.externalId,
					keezExternalId: invoiceHeader.externalId,
					syncDirection: 'pull',
					syncStatus: 'synced',
					lastSyncedAt: new Date()
				});

				imported++;
			} catch (error) {
				console.error(`[Keez] Failed to import invoice ${invoiceHeader.externalId}:`, error);
				skipped++;
			}
		}

		// Update integration last sync time
		await db
			.update(table.keezIntegration)
			.set({
				lastSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.keezIntegration.tenantId, event.locals.tenant.id));

		return { success: true, imported, skipped };
	}
);

export const importClientsFromKeez = command(
	v.object({
		offset: v.optional(v.number()),
		count: v.optional(v.number()),
		filter: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Get partners from Keez
		const response = await keezClient.getPartners({
			offset: filters.offset,
			count: filters.count || 100,
			filter: filters.filter
		});

		let imported = 0;
		let skipped = 0;

		// Import each partner
		for (const partner of response.partners || []) {
			try {
				// Check if client already exists
				if (partner.externalId) {
					const [existing] = await db
						.select()
						.from(table.client)
						.where(eq(table.client.keezPartnerId, partner.externalId))
						.limit(1);

					if (existing) {
						skipped++;
						continue;
					}
				}

				// Create new client
				const clientId = generateClientId();
				const clientData = mapKeezPartnerToClient(partner, event.locals.tenant.id);
				await db.insert(table.client).values({
					id: clientId,
					...clientData
				});

				// Create sync record
				if (partner.externalId) {
					const syncId = generateSyncId();
					await db.insert(table.keezClientSync).values({
						id: syncId,
						clientId,
						tenantId: event.locals.tenant.id,
						keezPartnerId: partner.externalId,
						keezExternalId: partner.externalId,
						syncStatus: 'synced',
						lastSyncedAt: new Date()
					});
				}

				imported++;
			} catch (error) {
				console.error(
					`[Keez] Failed to import partner ${partner.externalId || partner.name}:`,
					error
				);
				skipped++;
			}
		}

		return { success: true, imported, skipped };
	}
);

export const getInvoicePDFFromKeez = query(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		// Get PDF
		const pdfBuffer = await keezClient.downloadInvoicePDF(data.keezInvoiceId);

		// Convert to base64 for transmission
		const base64 = Buffer.from(pdfBuffer).toString('base64');

		return { pdf: base64 };
	}
);

export const validateInvoiceInKeez = command(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		await keezClient.validateInvoice(data.keezInvoiceId);

		return { success: true };
	}
);

export const sendInvoiceToEFactura = command(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		await keezClient.sendToEFactura(data.keezInvoiceId);

		return { success: true };
	}
);

export const cancelInvoiceInKeez = command(
	v.object({
		keezInvoiceId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.keezIntegration)
			.where(
				and(
					eq(table.keezIntegration.tenantId, event.locals.tenant.id),
					eq(table.keezIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('Keez integration not connected');
		}

		// Decrypt secret
		const secret = decrypt(event.locals.tenant.id, integration.secret);

		// Create Keez client
		const keezClient = new KeezClient({
			clientEid: integration.clientEid,
			applicationId: integration.applicationId,
			secret
		});

		await keezClient.cancelInvoice(data.keezInvoiceId);

		return { success: true };
	}
);
