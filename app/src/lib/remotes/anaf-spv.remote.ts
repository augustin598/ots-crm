import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, like } from 'drizzle-orm';
import { AnafSpvClient } from '$lib/server/plugins/anaf-spv/client';
import { encrypt, decrypt } from '$lib/server/plugins/anaf-spv/crypto';
import { parseUblInvoice } from '$lib/server/plugins/anaf-spv/xml-parser';
import { mapUblInvoiceToCrm, mapAnafCompanyToClient, normalizeVatId } from '$lib/server/plugins/anaf-spv/mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getHooksManager } from '$lib/server/plugins/manager';
import { generateStateToken, validateStateToken } from '$lib/server/plugins/anaf-spv/oauth-state';
import { dev } from '$app/environment';

function generateIntegrationId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateSyncId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateDocumentId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Get ANAF SPV OAuth authorization URL
 */
export const getAnafSpvAuthUrl = query(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can connect ANAF SPV
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Generate state token for CSRF protection
		const state = generateStateToken(event.locals.tenant.id);

		// Build redirect URI
		const origin = dev ? event.url.origin : event.url.origin.replace(/^http:/, 'https:');
		const redirectUri = `${origin}/${event.locals.tenant.slug}/settings/anaf-spv/callback`;

		// Generate authorization URL
		const authUrl = AnafSpvClient.getAuthorizationUrl(state, redirectUri, data.clientId);

		return {
			authUrl,
			state
		};
	}
);

/**
 * Connect ANAF SPV integration using OAuth authorization code
 */
export const connectAnafSpvWithOAuth = command(
	v.object({
		code: v.pipe(v.string(), v.minLength(1)),
		state: v.pipe(v.string(), v.minLength(1)),
		clientId: v.pipe(v.string(), v.minLength(1)),
		clientSecret: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can connect ANAF SPV
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Validate state token (CSRF protection)
		if (!validateStateToken(data.state, event.locals.tenant.id)) {
			throw new Error('Invalid or expired state token');
		}

		// Get tenant CUI/VAT code
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, event.locals.tenant.id))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required for ANAF SPV integration');
		}

		// Build redirect URI (must match the one used in authorization request)
		const origin = dev ? event.url.origin : event.url.origin.replace(/^http:/, 'https:');
		const redirectUri = `${origin}/${event.locals.tenant.slug}/settings/anaf-spv/callback`;

		// Exchange authorization code for tokens
		const tokenData = await AnafSpvClient.exchangeCodeForTokens(
			data.code,
			redirectUri,
			data.clientId,
			data.clientSecret
		);

		// Calculate expiration
		let expiresAt: Date | null = null;
		if (tokenData.expires_in) {
			expiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000); // Subtract 60s for safety
		} else {
			// Try to decode JWT to get expiration
			try {
				const parts = tokenData.access_token.split('.');
				if (parts.length === 3) {
					const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
					if (payload.exp) {
						expiresAt = new Date(payload.exp * 1000);
					}
				}
			} catch {
				// If we can't decode, default to 1 hour
				expiresAt = new Date(Date.now() + 3600 * 1000);
			}
		}

		// Test connection with API call
		const client = new AnafSpvClient({
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token,
			expiresAt,
			clientId: data.clientId,
			clientSecret: data.clientSecret
		});

		// Test API call - try to get invoices (will fail if token is invalid)
		try {
			await client.getInvoicesFromSpv(tenant.cui, 'P', 1); // Just test with 1 day
		} catch (error) {
			// If error is "Nu exista mesaje", that's fine - it means the token works
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (!errorMessage.includes('Nu exista mesaje')) {
				console.error('Failed to connect to ANAF SPV:', error);
				throw new Error(`Failed to connect to ANAF SPV: ${errorMessage}`);
			}
		}

		// Encrypt tokens and credentials
		const encryptedAccessToken = encrypt(event.locals.tenant.id, tokenData.access_token);
		const encryptedRefreshToken = encrypt(event.locals.tenant.id, tokenData.refresh_token);
		const encryptedClientId = encrypt(event.locals.tenant.id, data.clientId);
		const encryptedClientSecret = encrypt(event.locals.tenant.id, data.clientSecret);

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing integration
			await db
				.update(table.anafSpvIntegration)
				.set({
					clientId: encryptedClientId,
					clientSecret: encryptedClientSecret,
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					isActive: true,
					updatedAt: new Date()
				})
				.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id));
		} else {
			// Create new integration
			const integrationId = generateIntegrationId();
			await db.insert(table.anafSpvIntegration).values({
				id: integrationId,
				tenantId: event.locals.tenant.id,
				clientId: encryptedClientId,
				clientSecret: encryptedClientSecret,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
				isActive: true
			});
		}

		return { success: true };
	}
);

/**
 * Connect ANAF SPV integration (legacy - for backward compatibility)
 * Note: This assumes OAuth tokens are obtained through a separate OAuth flow
 * For now, we'll accept access token and refresh token directly
 */
export const connectAnafSpv = command(
	v.object({
		accessToken: v.pipe(v.string(), v.minLength(1)),
		refreshToken: v.pipe(v.string(), v.minLength(1)),
		clientId: v.optional(v.string()),
		clientSecret: v.optional(v.string()),
		expiresAt: v.optional(v.string()) // ISO date string
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can connect ANAF SPV
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Get tenant CUI/VAT code
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, event.locals.tenant.id))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required for ANAF SPV integration');
		}

		// Test connection
		const client = new AnafSpvClient({
			accessToken: data.accessToken,
			refreshToken: data.refreshToken,
			expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
			clientId: data.clientId,
			clientSecret: data.clientSecret
		});

		// Test API call - try to get invoices (will fail if token is invalid)
		try {
			await client.getInvoicesFromSpv(tenant.cui, 'P', 1); // Just test with 1 day
		} catch (error) {
			// If error is "Nu exista mesaje", that's fine - it means the token works
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (!errorMessage.includes('Nu exista mesaje')) {
				console.error('Failed to connect to ANAF SPV:', error);
				throw new Error(`Failed to connect to ANAF SPV: ${errorMessage}`);
			}
		}

		// Encrypt tokens
		const encryptedAccessToken = encrypt(event.locals.tenant.id, data.accessToken);
		const encryptedRefreshToken = encrypt(event.locals.tenant.id, data.refreshToken);
		const encryptedClientId = data.clientId ? encrypt(event.locals.tenant.id, data.clientId) : undefined;
		const encryptedClientSecret = data.clientSecret
			? encrypt(event.locals.tenant.id, data.clientSecret)
			: undefined;

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

		if (existing) {
			// Update existing integration
			const updateData: {
				accessToken: string;
				refreshToken: string;
				expiresAt: Date | null;
				isActive: boolean;
				updatedAt: Date;
				clientId?: string;
				clientSecret?: string;
			} = {
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
				isActive: true,
				updatedAt: new Date()
			};

			if (encryptedClientId) {
				updateData.clientId = encryptedClientId;
			}
			if (encryptedClientSecret) {
				updateData.clientSecret = encryptedClientSecret;
			}

			await db
				.update(table.anafSpvIntegration)
				.set(updateData)
				.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id));
		} else {
			// Create new integration
			const integrationId = generateIntegrationId();
			await db.insert(table.anafSpvIntegration).values({
				id: integrationId,
				tenantId: event.locals.tenant.id,
				clientId: encryptedClientId || null,
				clientSecret: encryptedClientSecret || null,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
				isActive: true
			});
		}

		return { success: true };
	}
);

export const disconnectAnafSpv = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can disconnect ANAF SPV
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	await db
		.update(table.anafSpvIntegration)
		.set({
			isActive: false,
			updatedAt: new Date()
		})
		.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id));

	return { success: true };
});

export const getAnafSpvStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [integration] = await db
		.select({
			isActive: table.anafSpvIntegration.isActive,
			lastSyncAt: table.anafSpvIntegration.lastSyncAt,
			expiresAt: table.anafSpvIntegration.expiresAt
		})
		.from(table.anafSpvIntegration)
		.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
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
		lastSyncAt: integration.lastSyncAt,
		expiresAt: integration.expiresAt
	};
});

/**
 * Sync invoices from SPV
 * @param filter - "P" for suppliers (received), "T" for sent
 * @param days - Number of days to look back (default: 60)
 */
export const syncInvoicesFromSpv = command(
	v.object({
		filter: v.union([v.literal('P'), v.literal('T')]),
		days: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(
				and(
					eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id),
					eq(table.anafSpvIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('ANAF SPV integration not connected or not active');
		}

		// Get tenant
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, event.locals.tenant.id))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required');
		}

		// Decrypt tokens and credentials
		const accessToken = decrypt(event.locals.tenant.id, integration.accessToken);
		const refreshToken = decrypt(event.locals.tenant.id, integration.refreshToken);
		const clientId = integration.clientId ? decrypt(event.locals.tenant.id, integration.clientId) : undefined;
		const clientSecret = integration.clientSecret
			? decrypt(event.locals.tenant.id, integration.clientSecret)
			: undefined;

		// Create SPV client
		const spvClient = new AnafSpvClient({
			accessToken,
			refreshToken,
			expiresAt: integration.expiresAt || undefined,
			clientId,
			clientSecret
		});

		// Get invoices from SPV
		const spvInvoices = await spvClient.getInvoicesFromSpv(
			tenant.cui,
			data.filter,
			data.days || 60
		);

		// Get already synced invoice IDs
		const syncedInvoices = await db
			.select({ spvId: table.anafSpvInvoiceSync.spvId })
			.from(table.anafSpvInvoiceSync)
			.where(
				and(
					eq(table.anafSpvInvoiceSync.tenantId, event.locals.tenant.id),
					eq(table.anafSpvInvoiceSync.syncDirection, 'pull')
				)
			);

		const syncedSpvIds = new Set(syncedInvoices.map((s) => s.spvId));

		let imported = 0;
		let skipped = 0;
		let errors = 0;

		// Process each invoice
		for (const spvInvoice of spvInvoices) {
			try {
				// Skip if already synced
				if (syncedSpvIds.has(spvInvoice.id)) {
					skipped++;
					continue;
				}

				// Download invoice XML
				const { xml } = await spvClient.getInvoiceFromSpv(spvInvoice.id);

				// Parse UBL XML
				const ublData = parseUblInvoice(xml);

				// Find or create client
				let clientId: string;

				// Normalize VAT ID for comparison
				const supplierVatId = normalizeVatId(ublData.supplier.vatId);

				// Try to find existing client by CUI or VAT code
				const [existingClient] = await db
					.select()
					.from(table.client)
					.where(
						and(
							eq(table.client.tenantId, event.locals.tenant.id),
							or(
								eq(table.client.cui, supplierVatId),
								like(table.client.vatCode, `%${supplierVatId}%`)
							)
						)
					)
					.limit(1);

				if (existingClient) {
					clientId = existingClient.id;
				} else {
					// Get company data from ANAF
					const companyData = await spvClient.getCompanyFromAnaf(ublData.supplier.vatId);

					if (!companyData) {
						// Create client with minimal data from invoice
						const newClientId = generateClientId();
						await db.insert(table.client).values({
							id: newClientId,
							tenantId: event.locals.tenant.id,
							name: ublData.supplier.name,
							cui: supplierVatId,
							vatCode: ublData.supplier.taxId || ublData.supplier.vatId,
							address: ublData.supplier.address,
							city: ublData.supplier.city,
							county: ublData.supplier.county,
							postalCode: ublData.supplier.postalCode,
							country: ublData.supplier.country || 'România',
							email: ublData.supplier.email,
							status: 'active'
						});
						clientId = newClientId;
					} else {
						// Create client from ANAF data
						const clientData = mapAnafCompanyToClient(companyData, event.locals.tenant.id);
						const newClientId = generateClientId();
						await db.insert(table.client).values({
							id: newClientId,
							...clientData
						});
						clientId = newClientId;
					}
				}

				// Map UBL invoice to CRM format
				const invoiceData = mapUblInvoiceToCrm(
					ublData,
					event.locals.tenant.id,
					event.locals.user.id,
					clientId
				);

				// Extract lineItems before inserting invoice
				const { lineItems, ...invoiceInsertData } = invoiceData;

				// Create invoice
				const invoiceId = generateInvoiceId();
				await db.insert(table.invoice).values({
					id: invoiceId,
					...invoiceInsertData,
					spvId: spvInvoice.id
				});

				// Create line items
				for (const lineItem of lineItems) {
					const lineItemId = generateLineItemId();
					await db.insert(table.invoiceLineItem).values({
						id: lineItemId,
						...lineItem,
						invoiceId
					});
				}

				// Store invoice XML as document
				const documentId = generateDocumentId();
				// Note: In a real implementation, you would upload the XML to MinIO
				// For now, we'll just create a document record
				// TODO: Upload XML file to MinIO and store file path

				// Create sync record
				const syncId = generateSyncId();
				await db.insert(table.anafSpvInvoiceSync).values({
					id: syncId,
					invoiceId,
					tenantId: event.locals.tenant.id,
					spvId: spvInvoice.id,
					syncDirection: 'pull',
					lastSyncedAt: new Date(),
					syncStatus: 'synced'
				});

				imported++;
			} catch (error) {
				console.error(`[ANAF-SPV] Failed to sync invoice ${spvInvoice.id}:`, error);
				errors++;

				// Create error sync record
				try {
					const syncId = generateSyncId();
					await db.insert(table.anafSpvInvoiceSync).values({
						id: syncId,
						invoiceId: '', // No invoice created
						tenantId: event.locals.tenant.id,
						spvId: spvInvoice.id,
						syncDirection: 'pull',
						syncStatus: 'error',
						errorMessage: error instanceof Error ? error.message : String(error)
					});
				} catch (syncError) {
					console.error(`[ANAF-SPV] Failed to create error sync record:`, syncError);
				}
			}
		}

		// Update integration last sync time
		await db
			.update(table.anafSpvIntegration)
			.set({
				lastSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.anafSpvIntegration.id, integration.id));

		return {
			success: true,
			imported,
			skipped,
			errors
		};
	}
);

/**
 * Upload single invoice to SPV
 */
export const uploadInvoiceToSpv = command(
	v.object({
		invoiceId: v.pipe(v.string(), v.minLength(1)),
		isExternal: v.optional(v.boolean())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get invoice
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(eq(table.invoice.id, data.invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!invoice) {
			throw new Error('Invoice not found');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(
				and(
					eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id),
					eq(table.anafSpvIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('ANAF SPV integration not connected or not active');
		}

		// Get tenant and client
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, event.locals.tenant.id))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required');
		}

		const [client] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, invoice.clientId))
			.limit(1);

		if (!client) {
			throw new Error('Client not found');
		}

		// Get line items
		const lineItems = await db
			.select()
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

		// Decrypt tokens and credentials
		const accessToken = decrypt(event.locals.tenant.id, integration.accessToken);
		const refreshToken = decrypt(event.locals.tenant.id, integration.refreshToken);
		const clientId = integration.clientId ? decrypt(event.locals.tenant.id, integration.clientId) : undefined;
		const clientSecret = integration.clientSecret
			? decrypt(event.locals.tenant.id, integration.clientSecret)
			: undefined;

		// Create SPV client
		const spvClient = new AnafSpvClient({
			accessToken,
			refreshToken,
			expiresAt: integration.expiresAt || undefined,
			clientId,
			clientSecret
		});

		// Map invoice to UBL format
		const { mapCrmInvoiceToUbl } = await import('$lib/server/plugins/anaf-spv/mapper');
		const { generateUblInvoice } = await import('$lib/server/plugins/anaf-spv/xml-parser');

		const ublData = mapCrmInvoiceToUbl({ ...invoice, lineItems }, tenant, client);

		// Generate UBL XML
		const xmlData = generateUblInvoice(
			ublData.invoice,
			ublData.supplier,
			ublData.customer,
			ublData.lineItems
		);

		// Upload to SPV
		const response = await spvClient.uploadInvoiceToSpv(
			xmlData,
			tenant.cui,
			data.isExternal || false
		);

		// Update invoice with SPV ID
		await db
			.update(table.invoice)
			.set({
				spvId: response.index_incarcare,
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoice.id));

		// Create or update sync record
		const [existingSync] = await db
			.select()
			.from(table.anafSpvInvoiceSync)
			.where(
				and(
					eq(table.anafSpvInvoiceSync.invoiceId, invoice.id),
					eq(table.anafSpvInvoiceSync.syncDirection, 'push')
				)
			)
			.limit(1);

		if (existingSync) {
			await db
				.update(table.anafSpvInvoiceSync)
				.set({
					spvId: response.index_incarcare,
					syncStatus: 'synced',
					lastSyncedAt: new Date(),
					errorMessage: null,
					updatedAt: new Date()
				})
				.where(eq(table.anafSpvInvoiceSync.id, existingSync.id));
		} else {
			const syncId = generateSyncId();
			await db.insert(table.anafSpvInvoiceSync).values({
				id: syncId,
				invoiceId: invoice.id,
				tenantId: event.locals.tenant.id,
				spvId: response.index_incarcare,
				syncDirection: 'push',
				lastSyncedAt: new Date(),
				syncStatus: 'synced'
			});
		}

		// Update integration last sync time
		await db
			.update(table.anafSpvIntegration)
			.set({
				lastSyncAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.anafSpvIntegration.id, integration.id));

		return {
			success: true,
			spvId: response.index_incarcare
		};
	}
);
