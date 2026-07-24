import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { getStripeForTenant, isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Admin-only: generate a Stripe hosted Checkout link so a client can pay an
 * ALREADY-EMITTED hosting invoice by card.
 *
 *   GET ?invoiceId=<id>   → { ok, url, invoice, amount, currency }
 *
 * The invoice already has its Keez fiscal invoice — the webhook branch
 * (metadata.crmPurpose='invoice_payment') only marks the CRM invoice paid; it
 * does NOT re-emit Keez or provision DirectAdmin (both would double up).
 *
 * The charged amount is the invoice `totalAmount` (gross, TVA already included),
 * so Stripe collects exactly the invoice total — no Stripe tax rate attached.
 *
 * Tenant-scoped on locals.tenant; invoice + client are loaded with an explicit
 * tenant filter (never by bare id).
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const tenantSlug = event.locals.tenant!.slug;
	const invoiceId = event.url.searchParams.get('invoiceId');
	const accountId = event.url.searchParams.get('accountId');

	if (!invoiceId && !accountId) {
		throw error(400, 'Trimite invoiceId sau accountId');
	}

	if (!(await isStripeConfiguredForTenant(tenantId))) {
		return json(
			{ ok: false, reason: 'Stripe nu e configurat pentru acest tenant — verifică /settings/stripe.' },
			{ status: 400 }
		);
	}

	// Multi-tenant: never fetch by bare id — scope every read to the tenant.
	// invoiceId wins; otherwise resolve the newest still-payable invoice linked to
	// the hosting account (draft/sent/overdue), which is what a client clicking a
	// renewal reminder wants to pay.
	let inv: typeof table.invoice.$inferSelect | undefined;
	if (invoiceId) {
		[inv] = await db
			.select()
			.from(table.invoice)
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
			.limit(1);
		if (!inv) throw error(404, 'Factura nu există pentru acest tenant');
	} else {
		[inv] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.hostingAccountId, accountId!),
					eq(table.invoice.tenantId, tenantId),
					inArray(table.invoice.status, ['draft', 'sent', 'overdue'])
				)
			)
			.orderBy(desc(table.invoice.issueDate))
			.limit(1);
		if (!inv) {
			return json(
				{ ok: false, reason: 'Niciun cont/factură neplătită găsită pentru acest accountId.' },
				{ status: 404 }
			);
		}
	}

	if (inv.status === 'paid') {
		return json({ ok: false, reason: 'Factura este deja plătită.' }, { status: 409 });
	}
	if (inv.status === 'cancelled') {
		return json({ ok: false, reason: 'Factura este anulată.' }, { status: 409 });
	}

	const totalCents = inv.totalAmount;
	if (!totalCents || totalCents <= 0) {
		return json({ ok: false, reason: 'Factura nu are un total valid de plată.' }, { status: 400 });
	}

	const [clientRow] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, inv.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!clientRow) throw error(404, 'Clientul facturii nu există');
	if (!clientRow.email) {
		return json(
			{ ok: false, reason: 'Clientul nu are email — nu se poate crea link de plată Stripe.' },
			{ status: 400 }
		);
	}

	// Best-effort domain label for a friendly Stripe line-item name.
	let domainLabel = '';
	if (inv.hostingAccountId) {
		const [acc] = await db
			.select({ domain: table.hostingAccount.domain })
			.from(table.hostingAccount)
			.where(
				and(
					eq(table.hostingAccount.id, inv.hostingAccountId),
					eq(table.hostingAccount.tenantId, tenantId)
				)
			)
			.limit(1);
		domainLabel = acc?.domain ?? '';
	}

	try {
		const stripe = await getStripeForTenant(tenantId);
		const customerId = await getOrCreateStripeCustomer(clientRow);

		const invoiceLabel = `${inv.invoiceSeries ?? ''}${inv.invoiceNumber}`.trim();
		const productName = domainLabel
			? `Hosting ${domainLabel} — factura ${invoiceLabel}`
			: `Factura ${invoiceLabel}`;

		const baseUrl = 'https://clients.onetopsolution.ro';
		const session = await stripe.checkout.sessions.create({
			customer: customerId,
			mode: 'payment',
			line_items: [
				{
					price_data: {
						currency: (inv.currency ?? 'RON').toLowerCase(),
						unit_amount: totalCents,
						product_data: { name: productName }
					},
					quantity: 1
				}
			],
			// `totalAmount` already includes TVA → NO tax rate. Stripe charges the
			// exact invoice total == the Keez fiscal invoice total.
			automatic_tax: { enabled: false },
			// Stripe emits its own payment receipt PDF; the RO fiscal invoice stays Keez.
			invoice_creation: { enabled: true },
			metadata: {
				crmPurpose: 'invoice_payment',
				crmTenantId: tenantId,
				crmInvoiceId: inv.id
			},
			client_reference_id: inv.id,
			locale: 'ro',
			success_url: `${baseUrl}/client/${tenantSlug}/invoices?paid=1`,
			cancel_url: `${baseUrl}/client/${tenantSlug}/invoices`
		});

		logInfo('directadmin', `pay-link generat pentru factura ${invoiceLabel}`, {
			tenantId,
			metadata: { invoiceId: inv.id, sessionId: session.id, totalCents, clientId: clientRow.id }
		});

		return json({
			ok: true,
			url: session.url,
			invoice: invoiceLabel,
			amount: (totalCents / 100).toFixed(2),
			currency: inv.currency ?? 'RON',
			domain: domainLabel || null,
			sessionId: session.id
		});
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('directadmin', `pay-link generation failed for invoice ${invoiceId}: ${message}`, {
			tenantId,
			metadata: { invoiceId },
			stackTrace: stack
		});
		throw error(500, `Nu s-a putut genera linkul de plată: ${message}`);
	}
};
