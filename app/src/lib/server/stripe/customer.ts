import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getStripe } from './client';

/**
 * Get or lazily create a Stripe Customer for a CRM client.
 *
 * Strategy:
 *  - First check `client.stripeCustomerId` cache.
 *  - If missing, search Stripe by email (idempotency in case of race / previous run).
 *  - If still missing, create new Customer with CUI as eu_vat tax_id.
 *  - Cache the result in DB.
 *
 * Returns the Stripe Customer ID (cus_...).
 */
export async function getOrCreateStripeCustomer(clientRow: {
	id: string;
	tenantId: string;
	name: string;
	businessName: string | null;
	email: string | null;
	phone: string | null;
	vatNumber: string | null;
	address: string | null;
	city: string | null;
	county: string | null;
	postalCode: string | null;
	country: string | null;
	stripeCustomerId: string | null;
}): Promise<string> {
	if (clientRow.stripeCustomerId) return clientRow.stripeCustomerId;
	if (!clientRow.email) {
		throw new Error('Clientul nu are email — nu putem crea Stripe Customer.');
	}

	const stripe = getStripe();
	const displayName = clientRow.businessName || clientRow.name;

	// Idempotency search — dacă există deja un customer cu email-ul ăsta în Stripe
	// (ex: crash anterior a creat customer dar n-a salvat ID-ul în CRM), reusam.
	const existing = await stripe.customers.list({ email: clientRow.email, limit: 1 });
	let customerId: string;

	if (existing.data.length > 0) {
		customerId = existing.data[0].id;
		// Update tax_id dacă lipsește pe customer-ul existent
		if (clientRow.vatNumber) {
			await ensureRomanianVatId(stripe, customerId, clientRow.vatNumber);
		}
	} else {
		const created = await stripe.customers.create({
			email: clientRow.email,
			name: displayName,
			phone: clientRow.phone ?? undefined,
			address: clientRow.address
				? {
						line1: clientRow.address,
						city: clientRow.city ?? undefined,
						state: clientRow.county ?? undefined,
						postal_code: clientRow.postalCode ?? undefined,
						country: clientRow.country ?? 'RO'
					}
				: undefined,
			metadata: {
				crmClientId: clientRow.id,
				crmTenantId: clientRow.tenantId,
				cui: clientRow.vatNumber ?? ''
			}
		});
		customerId = created.id;
		if (clientRow.vatNumber) {
			await ensureRomanianVatId(stripe, customerId, clientRow.vatNumber);
		}
	}

	// Cache în DB
	await db
		.update(table.client)
		.set({ stripeCustomerId: customerId, updatedAt: new Date() })
		.where(and(eq(table.client.id, clientRow.id), eq(table.client.tenantId, clientRow.tenantId)));

	return customerId;
}

/**
 * Ensure the Stripe Customer has the Romanian VAT ID (eu_vat type).
 * Idempotent — skips if already attached.
 */
async function ensureRomanianVatId(stripe: Stripe, customerId: string, cui: string) {
	const cleaned = cui.toUpperCase().replace(/^RO/, '');
	const taxIdValue = `RO${cleaned}`;
	try {
		const existing = await stripe.customers.listTaxIds(customerId, { limit: 10 });
		const already = existing.data.some(
			(t) => t.type === 'eu_vat' && t.value.toUpperCase() === taxIdValue
		);
		if (already) return;
		await stripe.customers.createTaxId(customerId, {
			type: 'eu_vat',
			value: taxIdValue
		});
	} catch {
		// Tax IDs sunt opționale — un fail aici nu blochează plata.
		// Stripe va warning în Dashboard că tax ID e invalid dar checkout-ul merge.
	}
}
