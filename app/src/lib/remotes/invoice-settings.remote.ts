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
			// Hosting-specific Keez series. Read by getNextInvoiceNumberFromPlugin when the
			// recurring template is linked to a hosting account (DA flow). Configured in
			// /[tenant]/settings/keez.
			keezSeriesHosting: null,
			keezStartNumberHosting: null,
			keezLastSyncedNumberHosting: null,
			// Zero-VAT compliance (intracom / export). Applies to ALL Keez-routed invoices when
			// auto-detect is on, including DA hosting recurring invoices. Configured in
			// /[tenant]/settings/keez. Column names retain whmcs_* prefix from the era when
			// only the WHMCS handler used them (rename → follow-up).
			whmcsZeroVatAutoDetect: true,
			whmcsZeroVatNoteIntracom: null,
			whmcsZeroVatNoteExport: null,
			whmcsStrictBnrConversion: true,
			defaultCurrency: 'RON',
			defaultTaxRate: 19,
			invoiceEmailsEnabled: true,
			sendInvoiceEmailEnabled: true,
			paidConfirmationEmailEnabled: true,
			overdueReminderEnabled: false,
			overdueReminderDaysAfterDue: 3,
			overdueReminderRepeatDays: 7,
			overdueReminderMaxCount: 3,
			autoSendRecurringInvoices: false,
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
		keezSeriesHosting: settings.keezSeriesHosting,
		keezStartNumberHosting: settings.keezStartNumberHosting,
		keezLastSyncedNumberHosting: settings.keezLastSyncedNumberHosting,
		whmcsZeroVatAutoDetect: settings.whmcsZeroVatAutoDetect ?? true,
		whmcsZeroVatNoteIntracom: settings.whmcsZeroVatNoteIntracom,
		whmcsZeroVatNoteExport: settings.whmcsZeroVatNoteExport,
		whmcsStrictBnrConversion: settings.whmcsStrictBnrConversion ?? true,
		defaultCurrency: settings.defaultCurrency || 'RON',
		defaultTaxRate: settings.defaultTaxRate ?? 19,
		invoiceEmailsEnabled: settings.invoiceEmailsEnabled ?? true,
		sendInvoiceEmailEnabled: settings.sendInvoiceEmailEnabled ?? true,
		paidConfirmationEmailEnabled: settings.paidConfirmationEmailEnabled ?? true,
		overdueReminderEnabled: settings.overdueReminderEnabled ?? false,
		overdueReminderDaysAfterDue: settings.overdueReminderDaysAfterDue ?? 3,
		overdueReminderRepeatDays: settings.overdueReminderRepeatDays ?? 7,
		overdueReminderMaxCount: settings.overdueReminderMaxCount ?? 3,
		autoSendRecurringInvoices: settings.autoSendRecurringInvoices ?? false,
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
		// Hosting-specific Keez series (DA hosting renewals). Editable from /[tenant]/settings/keez.
		// `keezLastSyncedNumberHosting` is not exposed here — it's set by the Keez sync job.
		keezSeriesHosting: v.optional(v.nullable(v.string())),
		keezStartNumberHosting: v.optional(v.nullable(v.string())),
		// Zero-VAT auto-detection + legal note text. Editable from /[tenant]/settings/keez.
		whmcsZeroVatAutoDetect: v.optional(v.boolean()),
		whmcsZeroVatNoteIntracom: v.optional(v.nullable(v.string())),
		whmcsZeroVatNoteExport: v.optional(v.nullable(v.string())),
		// Strict BNR rate freshness check for non-RON invoices. Editable from /[tenant]/settings/keez.
		whmcsStrictBnrConversion: v.optional(v.boolean()),
		defaultCurrency: v.optional(v.string()), // 'RON', 'EUR', 'USD', etc.
		defaultTaxRate: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))), // VAT percentage (0-100)
		invoiceEmailsEnabled: v.optional(v.boolean()),
		sendInvoiceEmailEnabled: v.optional(v.boolean()),
		paidConfirmationEmailEnabled: v.optional(v.boolean()),
		overdueReminderEnabled: v.optional(v.boolean()),
		overdueReminderDaysAfterDue: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(30))),
		overdueReminderRepeatDays: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(30))),
		overdueReminderMaxCount: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(10))),
		autoSendRecurringInvoices: v.optional(v.boolean()),
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
					keezSeriesHosting:
						data.keezSeriesHosting !== undefined ? data.keezSeriesHosting : undefined,
					keezStartNumberHosting:
						data.keezStartNumberHosting !== undefined ? data.keezStartNumberHosting : undefined,
					whmcsZeroVatAutoDetect:
						data.whmcsZeroVatAutoDetect !== undefined ? data.whmcsZeroVatAutoDetect : undefined,
					whmcsZeroVatNoteIntracom:
						data.whmcsZeroVatNoteIntracom !== undefined ? data.whmcsZeroVatNoteIntracom : undefined,
					whmcsZeroVatNoteExport:
						data.whmcsZeroVatNoteExport !== undefined ? data.whmcsZeroVatNoteExport : undefined,
					whmcsStrictBnrConversion:
						data.whmcsStrictBnrConversion !== undefined ? data.whmcsStrictBnrConversion : undefined,
					defaultCurrency: data.defaultCurrency !== undefined ? data.defaultCurrency : undefined,
					defaultTaxRate: data.defaultTaxRate !== undefined ? data.defaultTaxRate : undefined,
					invoiceEmailsEnabled:
						data.invoiceEmailsEnabled !== undefined ? data.invoiceEmailsEnabled : undefined,
					sendInvoiceEmailEnabled:
						data.sendInvoiceEmailEnabled !== undefined ? data.sendInvoiceEmailEnabled : undefined,
					paidConfirmationEmailEnabled:
						data.paidConfirmationEmailEnabled !== undefined ? data.paidConfirmationEmailEnabled : undefined,
					overdueReminderEnabled:
						data.overdueReminderEnabled !== undefined ? data.overdueReminderEnabled : undefined,
					overdueReminderDaysAfterDue:
						data.overdueReminderDaysAfterDue !== undefined ? data.overdueReminderDaysAfterDue : undefined,
					overdueReminderRepeatDays:
						data.overdueReminderRepeatDays !== undefined ? data.overdueReminderRepeatDays : undefined,
					overdueReminderMaxCount:
						data.overdueReminderMaxCount !== undefined ? data.overdueReminderMaxCount : undefined,
					autoSendRecurringInvoices:
						data.autoSendRecurringInvoices !== undefined ? data.autoSendRecurringInvoices : undefined,
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
				keezSeriesHosting: data.keezSeriesHosting ?? null,
				keezStartNumberHosting: data.keezStartNumberHosting ?? null,
				keezLastSyncedNumberHosting: null,
				whmcsZeroVatAutoDetect: data.whmcsZeroVatAutoDetect ?? true,
				whmcsZeroVatNoteIntracom: data.whmcsZeroVatNoteIntracom ?? null,
				whmcsZeroVatNoteExport: data.whmcsZeroVatNoteExport ?? null,
				whmcsStrictBnrConversion: data.whmcsStrictBnrConversion ?? true,
				defaultCurrency: data.defaultCurrency || 'RON',
				defaultTaxRate: data.defaultTaxRate ?? 19,
				invoiceEmailsEnabled: data.invoiceEmailsEnabled ?? true,
				sendInvoiceEmailEnabled: data.sendInvoiceEmailEnabled ?? true,
				paidConfirmationEmailEnabled: data.paidConfirmationEmailEnabled ?? true,
				overdueReminderEnabled: data.overdueReminderEnabled ?? false,
				overdueReminderDaysAfterDue: data.overdueReminderDaysAfterDue ?? 3,
				overdueReminderRepeatDays: data.overdueReminderRepeatDays ?? 7,
				overdueReminderMaxCount: data.overdueReminderMaxCount ?? 3,
				autoSendRecurringInvoices: data.autoSendRecurringInvoices ?? false,
				invoiceLogo: data.invoiceLogo || null
			});
		}

		return { success: true };
	}
);
