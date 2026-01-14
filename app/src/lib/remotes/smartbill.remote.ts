import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { SmartBillClient } from '$lib/server/plugins/smartbill/client';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import {
	mapInvoiceToSmartBill,
	mapSmartBillResponseToInvoice,
	mapSmartBillProductsToLineItems,
	generateNextInvoiceNumber
} from '$lib/server/plugins/smartbill/mapper';
import { encodeBase32LowerCase } from '@oslojs/encoding';

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

export const connectSmartBill = command(
	v.object({
		email: v.pipe(v.string(), v.minLength(1)),
		token: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can connect SmartBill
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Test connection
		const client = new SmartBillClient({
			email: data.email,
			token: data.token
		});

		// Get tenant CUI/VAT code
		const [tenant] = await db
			.select()
			.from(table.tenant)
			.where(eq(table.tenant.id, event.locals.tenant.id))
			.limit(1);

		if (!tenant || !tenant.cui) {
			throw new Error('Tenant CUI/VAT code is required for SmartBill integration');
		}

		// Test API call
		try {
			await client.getVATRates(tenant.cui);
		} catch (error) {
			console.error('Failed to connect to SmartBill:', error);
			throw new Error(
				`Failed to connect to SmartBill: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		// Encrypt token
		const encryptedToken = encrypt(event.locals.tenant.id, data.token);

		// Check if integration exists
		const [existing] = await db
			.select()
			.from(table.smartbillIntegration)
			.where(eq(table.smartbillIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing integration
			await db
				.update(table.smartbillIntegration)
				.set({
					email: data.email,
					token: encryptedToken,
					isActive: true,
					updatedAt: new Date()
				})
				.where(eq(table.smartbillIntegration.tenantId, event.locals.tenant.id));
		} else {
			// Create new integration
			const integrationId = generateIntegrationId();
			await db.insert(table.smartbillIntegration).values({
				id: integrationId,
				tenantId: event.locals.tenant.id,
				email: data.email,
				token: encryptedToken,
				isActive: true
			});
		}

		return { success: true };
	}
);

export const disconnectSmartBill = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can disconnect SmartBill
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	await db
		.update(table.smartbillIntegration)
		.set({
			isActive: false,
			updatedAt: new Date()
		})
		.where(eq(table.smartbillIntegration.tenantId, event.locals.tenant.id));

	return { success: true };
});

export const getSmartBillStatus = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [integration] = await db
		.select({
			email: table.smartbillIntegration.email,
			isActive: table.smartbillIntegration.isActive,
			lastSyncAt: table.smartbillIntegration.lastSyncAt
		})
		.from(table.smartbillIntegration)
		.where(eq(table.smartbillIntegration.tenantId, event.locals.tenant.id))
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
		email: integration.email,
		lastSyncAt: integration.lastSyncAt
	};
});

export const syncInvoiceToSmartBill = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invoiceId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get invoice
		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, event.locals.tenant.id))
			)
			.limit(1);

		if (!invoice) {
			throw new Error('Invoice not found');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.smartbillIntegration)
			.where(
				and(
					eq(table.smartbillIntegration.tenantId, event.locals.tenant.id),
					eq(table.smartbillIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('SmartBill integration not connected');
		}

		// Get invoice settings
		const [settings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		if (!settings || !settings.smartbillSeries) {
			throw new Error('SmartBill invoice series not configured');
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

		// Decrypt token
		const token = decrypt(event.locals.tenant.id, integration.token);

		// Create SmartBill client
		const smartBillClient = new SmartBillClient({
			email: integration.email,
			token
		});

		// Generate invoice number
		const invoiceNumber =
			invoice.smartbillNumber || generateNextInvoiceNumber(settings.smartbillLastSyncedNumber);

		// Map and create invoice with tax name mappings from settings
		const taxNameMappings = {
			apply: settings?.smartbillTaxNameApply || null,
			none: settings?.smartbillTaxNameNone || null,
			reverse: settings?.smartbillTaxNameReverse || null
		};
		const smartBillInvoice = mapInvoiceToSmartBill(
			{ ...invoice, lineItems },
			client,
			tenant,
			settings.smartbillSeries,
			invoiceNumber,
			taxNameMappings
		);

		const response = await smartBillClient.createInvoice(smartBillInvoice);

		// Update invoice
		await db
			.update(table.invoice)
			.set({
				smartbillSeries: response.series,
				smartbillNumber: response.number,
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		// Create/update sync record
		const [existingSync] = await db
			.select()
			.from(table.smartbillInvoiceSync)
			.where(eq(table.smartbillInvoiceSync.invoiceId, invoiceId))
			.limit(1);

		if (existingSync) {
			await db
				.update(table.smartbillInvoiceSync)
				.set({
					smartbillSeries: response.series,
					smartbillNumber: response.number,
					syncStatus: 'synced',
					lastSyncedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(table.smartbillInvoiceSync.id, existingSync.id));
		} else {
			const syncId = generateSyncId();
			await db.insert(table.smartbillInvoiceSync).values({
				id: syncId,
				invoiceId,
				tenantId: event.locals.tenant.id,
				smartbillSeries: response.series,
				smartbillNumber: response.number,
				smartbillCif: tenant.cui || tenant.vatNumber || '',
				syncDirection: 'push',
				syncStatus: 'synced',
				lastSyncedAt: new Date()
			});
		}

		// Update last synced number
		if (settings) {
			await db
				.update(table.invoiceSettings)
				.set({
					smartbillLastSyncedNumber: response.number,
					updatedAt: new Date()
				})
				.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id));
		}

		return { success: true, series: response.series, number: response.number };
	}
);

// DISABLED: SmartBill API does not support retrieving invoice data
// The SmartBill API only supports:
// - Creating invoices (POST /invoice)
// - Getting PDFs (GET /invoice/pdf)
// - Getting payment status (GET /invoice/paymentstatus)
// There is no endpoint to retrieve invoice details.
// export const syncInvoicesFromSmartBill = command(async () => {
// 	... entire function removed ...
// });

// DISABLED: SmartBill API does not support retrieving invoice data
// export const getInvoiceFromSmartBill = command(
// 	v.object({
// 		seriesName: v.pipe(v.string(), v.minLength(1)),
// 		number: v.pipe(v.string(), v.minLength(1))
// 	}),
// 	async (data) => {
// 		... entire function removed - SmartBill API doesn't support retrieving invoice details ...
// 	}
// );

export const getInvoicePDFFromSmartBill = query(
	v.object({
		seriesName: v.pipe(v.string(), v.minLength(1)),
		number: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.smartbillIntegration)
			.where(
				and(
					eq(table.smartbillIntegration.tenantId, event.locals.tenant.id),
					eq(table.smartbillIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('SmartBill integration not connected');
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

		// Decrypt token
		const token = decrypt(event.locals.tenant.id, integration.token);

		// Create SmartBill client
		const smartBillClient = new SmartBillClient({
			email: integration.email,
			token
		});

		// Get PDF
		const pdfBuffer = await smartBillClient.getInvoicePDF(tenant.cui, data.seriesName, data.number);

		// Convert to base64 for transmission
		const base64 = Buffer.from(pdfBuffer).toString('base64');

		return { pdf: base64 };
	}
);

export const getInvoicePaymentStatus = query(
	v.object({
		seriesName: v.pipe(v.string(), v.minLength(1)),
		number: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get integration
		const [integration] = await db
			.select()
			.from(table.smartbillIntegration)
			.where(
				and(
					eq(table.smartbillIntegration.tenantId, event.locals.tenant.id),
					eq(table.smartbillIntegration.isActive, true)
				)
			)
			.limit(1);

		if (!integration) {
			throw new Error('SmartBill integration not connected');
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

		// Decrypt token
		const token = decrypt(event.locals.tenant.id, integration.token);

		// Create SmartBill client
		const smartBillClient = new SmartBillClient({
			email: integration.email,
			token
		});

		// Get payment status
		const status = await smartBillClient.getInvoicePaymentStatus(
			tenant.cui,
			data.seriesName,
			data.number
		);

		return status;
	}
);
