import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateInvoiceSettingsId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getInvoiceSettings = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	// Return default settings if none exist
	if (!settings) {
		return {
			smartbillSeries: null,
			smartbillStartNumber: null,
			smartbillLastSyncedNumber: null,
			smartbillAutoSync: false,
			smartbillTaxNameApply: null,
			smartbillTaxNameNone: null,
			smartbillTaxNameReverse: null,
			keezSeries: null,
			keezStartNumber: null,
			keezLastSyncedNumber: null,
			keezAutoSync: false,
			keezDefaultPaymentTypeId: 3,
			defaultCurrency: 'RON',
			defaultTaxRate: 19,
			invoiceEmailsEnabled: true,
			invoiceLogo: null
		};
	}

	return {
		smartbillSeries: settings.smartbillSeries,
		smartbillStartNumber: settings.smartbillStartNumber,
		smartbillLastSyncedNumber: settings.smartbillLastSyncedNumber,
		smartbillAutoSync: settings.smartbillAutoSync,
		smartbillTaxNameApply: settings.smartbillTaxNameApply,
		smartbillTaxNameNone: settings.smartbillTaxNameNone,
		smartbillTaxNameReverse: settings.smartbillTaxNameReverse,
		keezSeries: settings.keezSeries,
		keezStartNumber: settings.keezStartNumber,
		keezLastSyncedNumber: settings.keezLastSyncedNumber,
		keezAutoSync: settings.keezAutoSync,
		keezDefaultPaymentTypeId: settings.keezDefaultPaymentTypeId ?? 3,
		defaultCurrency: settings.defaultCurrency || 'RON',
		defaultTaxRate: settings.defaultTaxRate ?? 19,
		invoiceEmailsEnabled: settings.invoiceEmailsEnabled ?? true,
		invoiceLogo: settings.invoiceLogo || null
	};
});

export const updateInvoiceSettings = command(
	v.object({
		smartbillSeries: v.optional(v.string()),
		smartbillStartNumber: v.optional(v.string()),
		smartbillAutoSync: v.optional(v.boolean()),
		smartbillTaxNameApply: v.optional(v.string()), // Tax name for 'apply' type
		smartbillTaxNameNone: v.optional(v.string()), // Tax name for 'none' type
		smartbillTaxNameReverse: v.optional(v.string()), // Tax name for 'reverse' type
		keezSeries: v.optional(v.string()),
		keezStartNumber: v.optional(v.string()),
		keezAutoSync: v.optional(v.boolean()),
		keezDefaultPaymentTypeId: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(9))),
		defaultCurrency: v.optional(v.string()), // 'RON', 'EUR', 'USD', etc.
		defaultTaxRate: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))), // VAT percentage (0-100)
		invoiceEmailsEnabled: v.optional(v.boolean()),
		invoiceLogo: v.optional(v.nullable(v.string())) // base64-encoded logo image, null to remove
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can update invoice settings
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Check if settings exist
		const [existing] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing settings
			await db
				.update(table.invoiceSettings)
				.set({
					smartbillSeries: data.smartbillSeries !== undefined ? data.smartbillSeries : undefined,
					smartbillStartNumber:
						data.smartbillStartNumber !== undefined ? data.smartbillStartNumber : undefined,
					smartbillAutoSync:
						data.smartbillAutoSync !== undefined ? data.smartbillAutoSync : undefined,
					smartbillTaxNameApply:
						data.smartbillTaxNameApply !== undefined ? data.smartbillTaxNameApply : undefined,
					smartbillTaxNameNone:
						data.smartbillTaxNameNone !== undefined ? data.smartbillTaxNameNone : undefined,
					smartbillTaxNameReverse:
						data.smartbillTaxNameReverse !== undefined ? data.smartbillTaxNameReverse : undefined,
					keezSeries: data.keezSeries !== undefined ? data.keezSeries : undefined,
					keezStartNumber: data.keezStartNumber !== undefined ? data.keezStartNumber : undefined,
					keezAutoSync: data.keezAutoSync !== undefined ? data.keezAutoSync : undefined,
					keezDefaultPaymentTypeId:
						data.keezDefaultPaymentTypeId !== undefined ? data.keezDefaultPaymentTypeId : undefined,
					defaultCurrency: data.defaultCurrency !== undefined ? data.defaultCurrency : undefined,
					defaultTaxRate: data.defaultTaxRate !== undefined ? data.defaultTaxRate : undefined,
					invoiceEmailsEnabled:
						data.invoiceEmailsEnabled !== undefined ? data.invoiceEmailsEnabled : undefined,
					invoiceLogo: data.invoiceLogo !== undefined ? data.invoiceLogo : undefined,
					updatedAt: new Date()
				})
				.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id));
		} else {
			// Create new settings
			const settingsId = generateInvoiceSettingsId();
			await db.insert(table.invoiceSettings).values({
				id: settingsId,
				tenantId: event.locals.tenant.id,
				smartbillSeries: data.smartbillSeries || null,
				smartbillStartNumber: data.smartbillStartNumber || null,
				smartbillLastSyncedNumber: null,
				smartbillAutoSync: data.smartbillAutoSync ?? false,
				smartbillTaxNameApply: data.smartbillTaxNameApply || null,
				smartbillTaxNameNone: data.smartbillTaxNameNone || null,
				smartbillTaxNameReverse: data.smartbillTaxNameReverse || null,
				keezSeries: data.keezSeries || null,
				keezStartNumber: data.keezStartNumber || null,
				keezLastSyncedNumber: null,
				keezAutoSync: data.keezAutoSync ?? false,
				keezDefaultPaymentTypeId: data.keezDefaultPaymentTypeId ?? 3,
				defaultCurrency: data.defaultCurrency || 'RON',
				defaultTaxRate: data.defaultTaxRate ?? 19,
				invoiceEmailsEnabled: data.invoiceEmailsEnabled ?? true,
				invoiceLogo: data.invoiceLogo || null
			});
		}

		return { success: true };
	}
);
