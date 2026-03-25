import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const load: LayoutServerLoad = async (event) => {
	if (
		!event.locals.user &&
		event.url.pathname !== `/client/${event.params.tenant}/login` &&
		event.url.pathname !== `/client/${event.params.tenant}/signup` &&
		event.url.pathname !== `/client/${event.params.tenant}/verify`
	) {
		throw redirect(302, `/client/${event.params.tenant}/login`);
	}

	const tenantSlug = event.params.tenant;
	if (!tenantSlug) {
		throw redirect(302, '/');
	}

	// Find tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw redirect(302, '/');
	}

	// Check if user is a client user for this tenant
	if (
		(!event.locals.isClientUser || !event.locals.client) &&
		event.url.pathname !== `/client/${tenantSlug}/login` &&
		event.url.pathname !== `/client/${tenantSlug}/signup` &&
		event.url.pathname !== `/client/${tenantSlug}/verify`
	) {
		throw redirect(302, `/client/${tenantSlug}/login`);
	}

	let defaultWebsiteUrl: string | null = null;
	if (event.locals.client) {
		const [defW] = await db
			.select({ url: table.clientWebsite.url })
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.clientId, event.locals.client.id),
					eq(table.clientWebsite.isDefault, true)
				)
			)
			.limit(1);
		defaultWebsiteUrl = defW?.url ?? null;
	}

	// Fetch invoice logo for branding (login page, etc.)
	const [invoiceSettingsRow] = await db
		.select({ invoiceLogo: table.invoiceSettings.invoiceLogo })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenant.id))
		.limit(1);

	// Compute client access restriction status
	let accessRestriction: {
		isRestricted: boolean;
		overdueDays: number | null;
		overdueInvoiceId: string | null;
		reason: 'overdue_invoice' | 'admin_forced' | null;
	} = { isRestricted: false, overdueDays: null, overdueInvoiceId: null, reason: null };

	if (event.locals.client) {
		const clientRecord = event.locals.client;

		if (clientRecord.restrictedAccess === 'unrestricted') {
			// Admin override: never restricted
			accessRestriction = { isRestricted: false, overdueDays: null, overdueInvoiceId: null, reason: null };
		} else if (clientRecord.restrictedAccess === 'forced') {
			// Admin override: always restricted
			accessRestriction = { isRestricted: true, overdueDays: null, overdueInvoiceId: null, reason: 'admin_forced' };
		} else {
			// Auto mode: check for overdue invoices
			const [overdueInvoice] = await db
				.select({
					id: table.invoice.id,
					dueDate: table.invoice.dueDate
				})
				.from(table.invoice)
				.where(
					and(
						eq(table.invoice.clientId, clientRecord.id),
						eq(table.invoice.tenantId, tenant.id),
						eq(table.invoice.status, 'overdue')
					)
				)
				.orderBy(table.invoice.dueDate)
				.limit(1);

			if (overdueInvoice?.dueDate) {
				const now = new Date();
				const dueDate = new Date(overdueInvoice.dueDate);
				const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
				accessRestriction = {
					isRestricted: true,
					overdueDays,
					overdueInvoiceId: overdueInvoice.id,
					reason: 'overdue_invoice'
				};
			}
		}
	}

	return {
		tenant,
		client: event.locals.client,
		clientUser: event.locals.clientUser,
		isClientUserPrimary: event.locals.clientUser?.isPrimary ?? true,
		user: event.locals.user
			? {
					id: event.locals.user.id,
					email: event.locals.user.email,
					firstName: event.locals.user.firstName,
					lastName: event.locals.user.lastName
				}
			: null,
		defaultWebsiteUrl,
		invoiceLogo: invoiceSettingsRow?.invoiceLogo ?? null,
		accessRestriction
	};
};
