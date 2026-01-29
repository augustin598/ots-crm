import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, like, sql } from 'drizzle-orm';
import { AnafSpvClient } from '$lib/server/plugins/anaf-spv/client';
import { encrypt, decrypt } from '$lib/server/plugins/anaf-spv/crypto';
import { parseUblInvoice } from '$lib/server/plugins/anaf-spv/xml-parser';
import {
	mapUblInvoiceToCrm,
	mapUblInvoiceToExpense,
	mapAnafCompanyToClient,
	mapAnafCompanyToSupplier,
	normalizeVatId,
	normalizeInvoiceNumber
} from '$lib/server/plugins/anaf-spv/mapper';
import { uploadBuffer } from '$lib/server/storage';
import { encodeBase32LowerCase } from '@oslojs/encoding';
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

function generateSupplierId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateExpenseId() {
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
 * Save ANAF SPV client credentials (before OAuth flow)
 */
export const saveAnafSpvCredentials = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		clientSecret: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can configure ANAF SPV
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Encrypt credentials
		const encryptedClientId = encrypt(event.locals.tenant.id, data.clientId);
		const encryptedClientSecret = encrypt(event.locals.tenant.id, data.clientSecret);

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing integration with credentials
			await db
				.update(table.anafSpvIntegration)
				.set({
					clientId: encryptedClientId,
					clientSecret: encryptedClientSecret,
					updatedAt: new Date()
				})
				.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id));
		} else {
			// Create new integration with credentials (but not tokens yet)
			const integrationId = generateIntegrationId();
			await db.insert(table.anafSpvIntegration).values({
				id: integrationId,
				tenantId: event.locals.tenant.id,
				clientId: encryptedClientId,
				clientSecret: encryptedClientSecret,
				accessToken: null,
				refreshToken: null,
				isActive: false // Not active until OAuth completes
			});
		}

		return { success: true };
	}
);

/**
 * Get ANAF SPV OAuth authorization URL
 * Uses stored client credentials from database
 */
export const getAnafSpvAuthUrl = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can connect ANAF SPV
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	// Get integration with stored credentials
	const [integration] = await db
		.select()
		.from(table.anafSpvIntegration)
		.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!integration || !integration.clientId || !integration.clientSecret) {
		throw new Error(
			'ANAF SPV credentials not configured. Please enter Client ID and Secret first.'
		);
	}

	// Decrypt client ID for authorization URL
	const clientId = decrypt(event.locals.tenant.id, integration.clientId);

	// Build redirect URI (must match EXACTLY in token exchange and what's registered with ANAF)
	const origin = dev ? event.url.origin : event.url.origin.replace(/^http:/, 'https:');
	const redirectUri = `${origin}/${event.locals.tenant.slug}/settings/anaf-spv/callback`;

	// Generate state token for CSRF protection (store redirect URI with it)
	const state = generateStateToken(event.locals.tenant.id, redirectUri);

	console.log('ANAF Authorization URL Generation:', {
		state,
		redirectUri,
		clientId: clientId.substring(0, 10) + '...'
	});

	// Generate authorization URL
	const authUrl = AnafSpvClient.getAuthorizationUrl(state, redirectUri, clientId);

	return {
		authUrl,
		state
	};
});

/**
 * Connect ANAF SPV integration using OAuth authorization code
 * Uses stored client credentials from database
 */
export const connectAnafSpvWithOAuth = command(
	v.object({
		code: v.pipe(v.string(), v.minLength(1)),
		state: v.pipe(v.string(), v.minLength(1))
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

		// Validate state token (CSRF protection) and get stored redirect URI
		// const storedRedirectUri = validateStateToken(data.state, event.locals.tenant.id);
		// if (!storedRedirectUri) {
		// 	throw new Error('Invalid or expired state token');
		// }

		// Get integration with stored credentials
		const [integration] = await db
			.select()
			.from(table.anafSpvIntegration)
			.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (!integration || !integration.clientId || !integration.clientSecret) {
			throw new Error(
				'ANAF SPV credentials not configured. Please enter Client ID and Secret first.'
			);
		}

		// Decrypt stored credentials
		const clientId = decrypt(event.locals.tenant.id, integration.clientId);
		const clientSecret = decrypt(event.locals.tenant.id, integration.clientSecret);

		// Get tenant CUI/VAT code
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, event.locals.tenant.id))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required for ANAF SPV integration');
		}

		// Use the redirect URI stored with the state token (must match exactly)
		// This ensures it matches what was used in the authorization request
		const origin = dev ? event.url.origin : event.url.origin.replace(/^http:/, 'https:');
		const redirectUri = `${origin}/${event.locals.tenant.slug}/settings/anaf-spv/callback`;

		console.log('ANAF OAuth Callback:', {
			code: data.code.substring(0, 10) + '...',
			state: data.state,
			clientId: clientId.substring(0, 10) + '...'
		});

		// Exchange authorization code for tokens using stored credentials
		// Use the exact redirect URI from the authorization request
		const tokenData = await AnafSpvClient.exchangeCodeForTokens(
			data.code,
			redirectUri,
			clientId,
			clientSecret
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
			expiresAt: expiresAt || undefined,
			clientId,
			clientSecret
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

		// Encrypt tokens (credentials already stored)
		const encryptedAccessToken = encrypt(event.locals.tenant.id, tokenData.access_token);
		const encryptedRefreshToken = encrypt(event.locals.tenant.id, tokenData.refresh_token);

		// Update integration with tokens (credentials already stored)
		await db
			.update(table.anafSpvIntegration)
			.set({
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
				isActive: true,
				updatedAt: new Date()
			})
			.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id));

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
		const encryptedClientId = data.clientId
			? encrypt(event.locals.tenant.id, data.clientId)
			: undefined;
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
			expiresAt: table.anafSpvIntegration.expiresAt,
			clientId: table.anafSpvIntegration.clientId,
			accessToken: table.anafSpvIntegration.accessToken
		})
		.from(table.anafSpvIntegration)
		.where(eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!integration) {
		return {
			connected: false,
			isActive: false,
			hasCredentials: false
		};
	}

	return {
		connected: !!integration.accessToken,
		isActive: integration.isActive,
		lastSyncAt: integration.lastSyncAt,
		expiresAt: integration.expiresAt,
		hasCredentials: !!integration.clientId
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
		if (!integration.accessToken || !integration.refreshToken) {
			throw new Error('ANAF SPV integration tokens not found');
		}

		const accessToken = decrypt(event.locals.tenant.id, integration.accessToken);
		const refreshToken = decrypt(event.locals.tenant.id, integration.refreshToken);
		const clientId = integration.clientId
			? decrypt(event.locals.tenant.id, integration.clientId)
			: undefined;
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
		let updated = 0;
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
				const { xml, zipBuffer } = await spvClient.getInvoiceFromSpv(spvInvoice.id);

				// Parse UBL XML
				const ublData = parseUblInvoice(xml);

				// Find or create supplier (these are expenses, not invoices we generated)
				let supplierId: string;

				// Normalize VAT ID for comparison
				const supplierVatId = normalizeVatId(ublData.supplier.vatId);

				// Try to find existing supplier by CUI or VAT code
				const [existingSupplier] = await db
					.select()
					.from(table.supplier)
					.where(
						and(
							eq(table.supplier.tenantId, event.locals.tenant.id),
							eq(table.supplier.cui, supplierVatId)
						)
					)
					.limit(1);

				if (existingSupplier) {
					supplierId = existingSupplier.id;
					
					// Update existing supplier with fresh data from invoice
					await db
						.update(table.supplier)
						.set({
							name: ublData.supplier.name,
							vatNumber: ublData.supplier.taxId || ublData.supplier.vatId,
							address: ublData.supplier.address || undefined,
							city: ublData.supplier.city || undefined,
							county: ublData.supplier.county || undefined,
							postalCode: ublData.supplier.postalCode || undefined,
							country: ublData.supplier.country || 'România',
							email: ublData.supplier.email || undefined,
							iban: ublData.supplier.iban || undefined,
							bankName: ublData.supplier.bankName || undefined,
							updatedAt: new Date()
						})
						.where(eq(table.supplier.id, supplierId));
				} else {
					// Get company data from ANAF
					const companyData = await spvClient.getCompanyFromAnaf(ublData.supplier.vatId);

					if (!companyData) {
						// Create supplier with minimal data from invoice
						const newSupplierId = generateSupplierId();
						await db.insert(table.supplier).values({
							id: newSupplierId,
							tenantId: event.locals.tenant.id,
							name: ublData.supplier.name,
							cui: supplierVatId,
							vatNumber: ublData.supplier.taxId || ublData.supplier.vatId,
							address: ublData.supplier.address,
							city: ublData.supplier.city,
							county: ublData.supplier.county,
							postalCode: ublData.supplier.postalCode,
							country: ublData.supplier.country || 'România',
							email: ublData.supplier.email,
							iban: ublData.supplier.iban,
							bankName: ublData.supplier.bankName
						});
						supplierId = newSupplierId;
					} else {
						// Create supplier from ANAF data with bank info
						const supplierData = mapAnafCompanyToSupplier(companyData, event.locals.tenant.id, {
							iban: ublData.supplier.iban,
							bankName: ublData.supplier.bankName
						});
						const newSupplierId = generateSupplierId();
						await db.insert(table.supplier).values({
							id: newSupplierId,
							...supplierData
						});
						supplierId = newSupplierId;
					}
				}

				// Map UBL invoice to expense format
				const expenseData = mapUblInvoiceToExpense(
					ublData,
					event.locals.tenant.id,
					event.locals.user.id,
					supplierId
				);

				// Create expense
				const expenseId = generateExpenseId();
				await db.insert(table.expense).values({
					id: expenseId,
					...expenseData
				});

				// Upload XML file to MinIO
				const xmlBuffer = Buffer.from(xml, 'utf-8');
				const xmlUpload = await uploadBuffer(
					event.locals.tenant.id,
					xmlBuffer,
					`factura-${ublData.invoiceNumber}-${spvInvoice.id}.xml`,
					'application/xml',
					{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
				);

				// Convert UBL to PDF and upload
				let pdfPath: string | null = null;
				try {
					const pdfBuffer = await spvClient.ublToPdf(xml, `Invoice ${ublData.invoiceNumber}`);
					if (pdfBuffer) {
						const pdfUpload = await uploadBuffer(
							event.locals.tenant.id,
							pdfBuffer,
							`factura-${ublData.invoiceNumber}-${spvInvoice.id}.pdf`,
							'application/pdf',
							{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
						);
						pdfPath = pdfUpload.path;

						// Update expense with PDF path
						await db
							.update(table.expense)
							.set({
								invoicePath: pdfPath,
								updatedAt: new Date()
							})
							.where(eq(table.expense.id, expenseId));
					}
				} catch (pdfError) {
					console.error(
						`[ANAF-SPV] Failed to convert UBL to PDF for invoice ${spvInvoice.id}:`,
						pdfError
					);
					// Continue even if PDF conversion fails
				}

				// Create sync record for expense
				const syncId = generateSyncId();
				await db.insert(table.anafSpvInvoiceSync).values({
					id: syncId,
					expenseId: expenseId, // Store expenseId for pull operations
					invoiceId: null, // Only set for push operations
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
						invoiceId: null, // No invoice created - nullable for error records
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
			updated: 0, // Legacy command doesn't differentiate, always reports as imported
			skipped,
			errors
		};
	}
);

/**
 * Sync sent invoices from SPV (invoices you created and sent to clients)
 * @param days - Number of days to look back (default: 60)
 */
export const syncSentInvoicesFromSpv = command(
	v.object({
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
		if (!integration.accessToken || !integration.refreshToken) {
			throw new Error('ANAF SPV integration tokens not found');
		}

		const accessToken = decrypt(event.locals.tenant.id, integration.accessToken);
		const refreshToken = decrypt(event.locals.tenant.id, integration.refreshToken);
		const clientId = integration.clientId
			? decrypt(event.locals.tenant.id, integration.clientId)
			: undefined;
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

		// Get sent invoices from SPV (filter = 'T' for transmitted/sent)
		const spvInvoices = await spvClient.getInvoicesFromSpv(
			tenant.cui,
			'T',
			data.days || 60
		);

		// Get already synced invoice IDs for sent invoices
		const syncedInvoices = await db
			.select({ spvId: table.anafSpvInvoiceSync.spvId })
			.from(table.anafSpvInvoiceSync)
			.where(
				and(
					eq(table.anafSpvInvoiceSync.tenantId, event.locals.tenant.id),
					eq(table.anafSpvInvoiceSync.syncDirection, 'pull-sent')
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
				const { xml, zipBuffer } = await spvClient.getInvoiceFromSpv(spvInvoice.id);

				// Parse UBL XML
				const ublData = parseUblInvoice(xml);

				// Find or create client (these are invoices we sent, so customer = client)
				let clientId: string;

				// Normalize VAT ID for comparison
				const customerVatId = normalizeVatId(ublData.customer.vatId);
				
				console.log(`[ANAF-SPV] Processing customer: ${ublData.customer.name}`);
				console.log(`[ANAF-SPV] Customer VAT ID (raw): ${ublData.customer.vatId}`);
				console.log(`[ANAF-SPV] Customer VAT ID (normalized): ${customerVatId}`);

				// Try to find existing client by CUI, VAT number, or registration number
				// (check both with and without RO prefix, and also check if registration number was mistakenly stored in vatNumber)
				const [existingClient] = await db
					.select()
					.from(table.client)
					.where(
						and(
							eq(table.client.tenantId, event.locals.tenant.id),
							or(
								eq(table.client.cui, customerVatId),
								eq(table.client.cui, ublData.customer.vatId),
								eq(table.client.vatNumber, customerVatId),
								eq(table.client.vatNumber, ublData.customer.vatId),
								// Also check if registration number (J...) was mistakenly stored in vatNumber
								ublData.customer.taxId ? eq(table.client.vatNumber, ublData.customer.taxId) : sql`false`,
								ublData.customer.taxId ? eq(table.client.registrationNumber, ublData.customer.taxId) : sql`false`
							)
						)
					)
					.limit(1);

				if (existingClient) {
					clientId = existingClient.id;
					console.log(`[ANAF-SPV] Found existing client: ${existingClient.name} (ID: ${clientId})`);
					console.log(`[ANAF-SPV] Existing client CUI: ${existingClient.cui}, VAT: ${existingClient.vatNumber}, Reg: ${existingClient.registrationNumber}`);
					
					// Check if existing client has incorrect data (registration number in wrong fields)
					const needsCorrection = 
						(existingClient.cui && existingClient.cui.startsWith('J')) || 
						(existingClient.vatNumber && existingClient.vatNumber.startsWith('J'));
					
					if (needsCorrection) {
						console.log(`[ANAF-SPV] ⚠️  Client has incorrect data (J... in CUI/VAT fields), correcting...`);
					}
					
					// Update existing client with fresh data from invoice
					// Always update CUI to ensure it's correct (numeric only, no RO prefix)
					await db
						.update(table.client)
						.set({
							name: ublData.customer.name,
							cui: customerVatId, // Always set correct CUI
							vatNumber: ublData.customer.vatId,
							registrationNumber: ublData.customer.taxId || undefined,
							address: ublData.customer.address || undefined,
							city: ublData.customer.city || undefined,
							county: ublData.customer.county || undefined,
							postalCode: ublData.customer.postalCode || undefined,
							country: ublData.customer.country || 'România',
							email: ublData.customer.email || undefined,
							iban: ublData.customer.iban || undefined,
							bankName: ublData.customer.bankName || undefined,
							updatedAt: new Date()
						})
						.where(eq(table.client.id, clientId));
					
					console.log(`[ANAF-SPV] Client updated with correct data`);
				} else {
					console.log(`[ANAF-SPV] Client not found, fetching from ANAF...`);
					
					// Get company data from ANAF
					const companyData = await spvClient.getCompanyFromAnaf(ublData.customer.vatId);

					if (!companyData) {
						console.log(`[ANAF-SPV] Company not found in ANAF, creating with invoice data`);
						
						// Create client with minimal data from invoice
						const newClientId = generateClientId();
						const clientInsertData = {
							id: newClientId,
							tenantId: event.locals.tenant.id,
							name: ublData.customer.name,
							cui: customerVatId,
							vatNumber: ublData.customer.vatId,
							registrationNumber: ublData.customer.taxId || null,
							address: ublData.customer.address,
							city: ublData.customer.city,
							county: ublData.customer.county,
							postalCode: ublData.customer.postalCode,
							country: ublData.customer.country || 'România',
							email: ublData.customer.email,
							iban: ublData.customer.iban,
							bankName: ublData.customer.bankName,
							status: 'active'
						};
						
						console.log(`[ANAF-SPV] Creating client:`, {
							name: clientInsertData.name,
							cui: clientInsertData.cui,
							vatNumber: clientInsertData.vatNumber,
							registrationNumber: clientInsertData.registrationNumber
						});
						
						await db.insert(table.client).values(clientInsertData);
						clientId = newClientId;
						console.log(`[ANAF-SPV] Client created with ID: ${clientId}`);
					} else {
						console.log(`[ANAF-SPV] Company found in ANAF: ${companyData.name}`);
						console.log(`[ANAF-SPV] ANAF data:`, {
							vat_id: companyData.vat_id,
							reg_no: companyData.reg_no,
							tax_id: companyData.tax_id
						});
						
						// Create client from ANAF data with bank info
						const clientData = mapAnafCompanyToClient(companyData, event.locals.tenant.id, {
							iban: ublData.customer.iban,
							bankName: ublData.customer.bankName,
						});
						
						console.log(`[ANAF-SPV] Mapped client data:`, {
							name: clientData.name,
							cui: clientData.cui,
							vatNumber: clientData.vatNumber,
							registrationNumber: clientData.registrationNumber
						});
						
						const newClientId = generateClientId();
						await db.insert(table.client).values({
							id: newClientId,
							...clientData
						});
						clientId = newClientId;
						console.log(`[ANAF-SPV] Client created from ANAF data with ID: ${clientId}`);
					}
				}

				// Map UBL invoice to CRM invoice format
				const invoiceData = mapUblInvoiceToCrm(ublData, event.locals.tenant.id, event.locals.user.id, clientId);
				
				// Check if invoice already exists by invoice number (normalized comparison)
				const normalizedInvoiceNumber = normalizeInvoiceNumber(ublData.invoiceNumber);
				
				const potentialInvoices = await db
					.select()
					.from(table.invoice)
					.where(eq(table.invoice.tenantId, event.locals.tenant.id));
				
				const existingInvoice = potentialInvoices.find(inv => 
					normalizeInvoiceNumber(inv.invoiceNumber) === normalizedInvoiceNumber
				);
				
				let invoiceId: string;
				
				if (existingInvoice) {
					// Invoice already exists, update it
					invoiceId = existingInvoice.id;
					console.log(`[ANAF-SPV] Found existing invoice: ${existingInvoice.invoiceNumber} (ID: ${invoiceId}), updating...`);
					console.log(`[ANAF-SPV] Keeping existing invoice number format: "${existingInvoice.invoiceNumber}" (SPV has: "${ublData.invoiceNumber}")`);
					
					await db
						.update(table.invoice)
						.set({
							spvId: spvInvoice.id,
							// Do NOT update invoiceNumber - keep the existing format
							status: invoiceData.status,
							amount: invoiceData.amount,
							taxRate: invoiceData.taxRate,
							taxAmount: invoiceData.taxAmount,
							totalAmount: invoiceData.totalAmount,
							issueDate: invoiceData.issueDate,
							dueDate: invoiceData.dueDate,
							currency: invoiceData.currency,
							updatedAt: new Date()
						})
						.where(eq(table.invoice.id, existingInvoice.id));
					
					console.log(`[ANAF-SPV] Invoice updated with ID: ${invoiceId}`);
				} else {
					// Create new invoice
					invoiceId = generateInvoiceId();
					console.log(`[ANAF-SPV] Creating new invoice ${ublData.invoiceNumber} with ${invoiceData.lineItems.length} line items`);
					
					await db.insert(table.invoice).values({
						id: invoiceId,
						...invoiceData,
						spvId: spvInvoice.id // Store SPV ID in invoice
					});
					
					console.log(`[ANAF-SPV] Invoice created with ID: ${invoiceId}`);
				}

				// Sync line items (always recreate to ensure up to date)
				const existingLineItems = await db
					.select()
					.from(table.invoiceLineItem)
					.where(eq(table.invoiceLineItem.invoiceId, invoiceId));
				
				console.log(`[ANAF-SPV] Existing line items: ${existingLineItems.length}, New line items: ${invoiceData.lineItems.length}`);
				
				if (existingLineItems.length > 0) {
					// Delete existing line items first
					console.log(`[ANAF-SPV] 🔄 Syncing ${invoiceData.lineItems.length} line items (recreating to ensure data is up to date)...`);
					console.log(`[ANAF-SPV] Deleting ${existingLineItems.length} existing line items first...`);
					
					await db
						.delete(table.invoiceLineItem)
						.where(eq(table.invoiceLineItem.invoiceId, invoiceId));
					
					// Verify deletion
					const remainingLineItems = await db
						.select()
						.from(table.invoiceLineItem)
						.where(eq(table.invoiceLineItem.invoiceId, invoiceId));
					
					if (remainingLineItems.length > 0) {
						console.error(`[ANAF-SPV] ❌ ERROR: ${remainingLineItems.length} line items still exist after deletion! Aborting sync to prevent duplicates.`);
						throw new Error(`Failed to delete line items for invoice ${invoiceId}`);
					}
					
					console.log(`[ANAF-SPV] ✅ Verified: All old line items deleted. Creating ${invoiceData.lineItems.length} new items...`);
				} else if (existingLineItems.length === 0 && invoiceData.lineItems.length > 0) {
					console.log(`[ANAF-SPV] Creating ${invoiceData.lineItems.length} line items for invoice ${invoiceId}`);
				}
				
				// Create line items
				for (const [index, lineItem] of invoiceData.lineItems.entries()) {
					const lineItemId = generateLineItemId();
					const { invoiceId: _unused, ...lineItemData } = lineItem;
					
					console.log(`[ANAF-SPV] Line item ${index + 1}:`, {
						id: lineItemId,
						invoiceId: invoiceId,
						description: lineItemData.description?.substring(0, 50),
						quantity: lineItemData.quantity,
						rate: lineItemData.rate,
						amount: lineItemData.amount
					});
					
					await db.insert(table.invoiceLineItem).values({
						id: lineItemId,
						invoiceId: invoiceId,
						...lineItemData
					});
					
					console.log(`[ANAF-SPV] Line item ${index + 1} synced successfully`);
				}
				
				// Final verification
				const finalLineItems = await db
					.select()
					.from(table.invoiceLineItem)
					.where(eq(table.invoiceLineItem.invoiceId, invoiceId));
				
				console.log(`[ANAF-SPV] ✅ All ${finalLineItems.length} line items synced (expected: ${invoiceData.lineItems.length})`);
				
				if (finalLineItems.length !== invoiceData.lineItems.length) {
					console.error(`[ANAF-SPV] ⚠️  WARNING: Line item count mismatch! Expected ${invoiceData.lineItems.length}, got ${finalLineItems.length}`);
				}

				// Upload XML file to MinIO
				const xmlBuffer = Buffer.from(xml, 'utf-8');
				const xmlUpload = await uploadBuffer(
					event.locals.tenant.id,
					xmlBuffer,
					`factura-${ublData.invoiceNumber}-${spvInvoice.id}.xml`,
					'application/xml',
					{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
				);

				// Convert UBL to PDF and upload
				let pdfPath: string | null = null;
				try {
					const pdfBuffer = await spvClient.ublToPdf(xml, `Invoice ${ublData.invoiceNumber}`);
					if (pdfBuffer) {
						const pdfUpload = await uploadBuffer(
							event.locals.tenant.id,
							pdfBuffer,
							`factura-${ublData.invoiceNumber}-${spvInvoice.id}.pdf`,
							'application/pdf',
							{ 'spv-id': spvInvoice.id, 'invoice-number': ublData.invoiceNumber }
						);
						pdfPath = pdfUpload.path;
					}
				} catch (pdfError) {
					console.error(
						`[ANAF-SPV] Failed to convert UBL to PDF for invoice ${spvInvoice.id}:`,
						pdfError
					);
					// Continue even if PDF conversion fails
				}

				// Create sync record for invoice
				const syncId = generateSyncId();
				await db.insert(table.anafSpvInvoiceSync).values({
					id: syncId,
					invoiceId: invoiceId, // Store invoiceId for sent invoice sync
					expenseId: null, // Only set for expense (received) operations
					tenantId: event.locals.tenant.id,
					spvId: spvInvoice.id,
					syncDirection: 'pull-sent', // New direction for pulling sent invoices
					lastSyncedAt: new Date(),
					syncStatus: 'synced'
				});

				imported++;
			} catch (error) {
				console.error(`[ANAF-SPV] Failed to sync sent invoice ${spvInvoice.id}:`, error);
				errors++;

				// Create error sync record
				try {
					const syncId = generateSyncId();
					await db.insert(table.anafSpvInvoiceSync).values({
						id: syncId,
						invoiceId: null, // No invoice created - nullable for error records
						expenseId: null,
						tenantId: event.locals.tenant.id,
						spvId: spvInvoice.id,
						syncDirection: 'pull-sent',
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
			updated: 0,
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
		// const event = getRequestEvent();
		// if (!event?.locals.user || !event?.locals.tenant) {
		// 	throw new Error('Unauthorized');
		// }

		// // Get invoice
		// const [invoice] = await db
		// 	.select()
		// 	.from(table.invoice)
		// 	.where(
		// 		and(
		// 			eq(table.invoice.id, data.invoiceId),
		// 			eq(table.invoice.tenantId, event.locals.tenant.id)
		// 		)
		// 	)
		// 	.limit(1);

		// if (!invoice) {
		// 	throw new Error('Invoice not found');
		// }

		// // Get integration
		// const [integration] = await db
		// 	.select()
		// 	.from(table.anafSpvIntegration)
		// 	.where(
		// 		and(
		// 			eq(table.anafSpvIntegration.tenantId, event.locals.tenant.id),
		// 			eq(table.anafSpvIntegration.isActive, true)
		// 		)
		// 	)
		// 	.limit(1);

		// if (!integration) {
		// 	throw new Error('ANAF SPV integration not connected or not active');
		// }

		// // Get tenant and client
		// const [tenant] = await db
		// 	.select()
		// 	.from(table.tenant)
		// 	.where(eq(table.tenant.id, event.locals.tenant.id))
		// 	.limit(1);

		// if (!tenant || !tenant.cui) {
		// 	throw new Error('Tenant CUI/VAT code is required');
		// }

		// const [client] = await db
		// 	.select()
		// 	.from(table.client)
		// 	.where(eq(table.client.id, invoice.clientId))
		// 	.limit(1);

		// if (!client) {
		// 	throw new Error('Client not found');
		// }

		// // Get line items
		// const lineItems = await db
		// 	.select()
		// 	.from(table.invoiceLineItem)
		// 	.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

		// // Decrypt tokens and credentials
		// if (!integration.accessToken || !integration.refreshToken) {
		// 	throw new Error('ANAF SPV integration tokens not found');
		// }

		// const accessToken = decrypt(event.locals.tenant.id, integration.accessToken);
		// const refreshToken = decrypt(event.locals.tenant.id, integration.refreshToken);
		// const clientId = integration.clientId
		// 	? decrypt(event.locals.tenant.id, integration.clientId)
		// 	: undefined;
		// const clientSecret = integration.clientSecret
		// 	? decrypt(event.locals.tenant.id, integration.clientSecret)
		// 	: undefined;

		// // Create SPV client
		// const spvClient = new AnafSpvClient({
		// 	accessToken,
		// 	refreshToken,
		// 	expiresAt: integration.expiresAt || undefined,
		// 	clientId,
		// 	clientSecret
		// });

		// // Map invoice to UBL format
		// const { mapCrmInvoiceToUbl } = await import('$lib/server/plugins/anaf-spv/mapper');
		// const { generateUblInvoice } = await import('$lib/server/plugins/anaf-spv/xml-parser');

		// const ublData = mapCrmInvoiceToUbl({ ...invoice, lineItems }, tenant, client);

		// // Generate UBL XML
		// const xmlData = generateUblInvoice(
		// 	ublData.invoice,
		// 	ublData.supplier,
		// 	ublData.customer,
		// 	ublData.lineItems
		// );

		// // Upload to SPV
		// const response = await spvClient.uploadInvoiceToSpv(
		// 	xmlData,
		// 	tenant.cui,
		// 	data.isExternal || false
		// );

		// // Update invoice with SPV ID
		// await db
		// 	.update(table.invoice)
		// 	.set({
		// 		spvId: response.index_incarcare,
		// 		updatedAt: new Date()
		// 	})
		// 	.where(eq(table.invoice.id, invoice.id));

		// // Create or update sync record
		// const [existingSync] = await db
		// 	.select()
		// 	.from(table.anafSpvInvoiceSync)
		// 	.where(
		// 		and(
		// 			eq(table.anafSpvInvoiceSync.invoiceId, invoice.id),
		// 			eq(table.anafSpvInvoiceSync.syncDirection, 'push')
		// 		)
		// 	)
		// 	.limit(1);

		// if (existingSync) {
		// 	await db
		// 		.update(table.anafSpvInvoiceSync)
		// 		.set({
		// 			spvId: response.index_incarcare,
		// 			syncStatus: 'synced',
		// 			lastSyncedAt: new Date(),
		// 			errorMessage: null,
		// 			updatedAt: new Date()
		// 		})
		// 		.where(eq(table.anafSpvInvoiceSync.id, existingSync.id));
		// } else {
		// 	const syncId = generateSyncId();
		// 	await db.insert(table.anafSpvInvoiceSync).values({
		// 		id: syncId,
		// 		invoiceId: invoice.id,
		// 		tenantId: event.locals.tenant.id,
		// 		spvId: response.index_incarcare,
		// 		syncDirection: 'push',
		// 		lastSyncedAt: new Date(),
		// 		syncStatus: 'synced'
		// 	});
		// }

		// // Update integration last sync time
		// await db
		// 	.update(table.anafSpvIntegration)
		// 	.set({
		// 		lastSyncAt: new Date(),
		// 		updatedAt: new Date()
		// 	})
		// 	.where(eq(table.anafSpvIntegration.id, integration.id));

		// return {
		// 	success: true,
		// 	spvId: response.index_incarcare
		// };
	}
);
