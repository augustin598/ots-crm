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
			keezSeries: null,
			keezStartNumber: null,
			keezLastSyncedNumber: null,
			keezAutoSync: false,
			defaultCurrency: 'RON',
			invoiceEmailsEnabled: true
		};
	}

	return {
		smartbillSeries: settings.smartbillSeries,
		smartbillStartNumber: settings.smartbillStartNumber,
		smartbillLastSyncedNumber: settings.smartbillLastSyncedNumber,
		smartbillAutoSync: settings.smartbillAutoSync,
		keezSeries: settings.keezSeries,
		keezStartNumber: settings.keezStartNumber,
		keezLastSyncedNumber: settings.keezLastSyncedNumber,
		keezAutoSync: settings.keezAutoSync,
		defaultCurrency: settings.defaultCurrency || 'RON',
		invoiceEmailsEnabled: settings.invoiceEmailsEnabled ?? true
	};
});

export const updateInvoiceSettings = command(
	v.object({
		smartbillSeries: v.optional(v.string()),
		smartbillStartNumber: v.optional(v.string()),
		smartbillAutoSync: v.optional(v.boolean()),
		keezSeries: v.optional(v.string()),
		keezStartNumber: v.optional(v.string()),
		keezAutoSync: v.optional(v.boolean()),
		defaultCurrency: v.optional(v.string()), // 'RON', 'EUR', 'USD', etc.
		invoiceEmailsEnabled: v.optional(v.boolean())
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
					smartbillStartNumber: data.smartbillStartNumber !== undefined ? data.smartbillStartNumber : undefined,
					smartbillAutoSync: data.smartbillAutoSync !== undefined ? data.smartbillAutoSync : undefined,
					defaultCurrency: data.defaultCurrency !== undefined ? data.defaultCurrency : undefined,
					invoiceEmailsEnabled: data.invoiceEmailsEnabled !== undefined ? data.invoiceEmailsEnabled : undefined,
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
				keezSeries: data.keezSeries || null,
				keezStartNumber: data.keezStartNumber || null,
				keezLastSyncedNumber: null,
				keezAutoSync: data.keezAutoSync ?? false,
				defaultCurrency: data.defaultCurrency || 'RON',
				invoiceEmailsEnabled: data.invoiceEmailsEnabled ?? true
			});
		}

		return { success: true };
	}
);
