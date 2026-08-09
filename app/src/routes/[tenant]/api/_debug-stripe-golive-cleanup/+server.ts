import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Pregătirea trecerii Stripe de pe TEST pe LIVE.
 *
 *   GET ?action=check            — ce id-uri de test există (implicit, nu schimbă nimic)
 *   GET ?action=clear            — dry-run: ce s-ar șterge
 *   GET ?action=clear&apply=1    — șterge efectiv
 *
 * De ce e nevoie: `client.stripe_customer_id` și `hosting_product.stripe_price_id`
 * sunt cache-uri ale unor obiecte Stripe. Obiectele din test NU există în live —
 * `getOrCreateStripeCustomer` returnează orb id-ul din cache (fără să verifice),
 * deci prima comandă după trecerea pe live ar muri cu „No such customer”.
 * Golite, se recreează singure la prima folosire, pe contul live.
 *
 * Nu atinge facturi, comenzi sau evenimente webhook — doar cele două cache-uri.
 * Idempotent: a doua rulare nu mai găsește nimic de curățat.
 *
 * Admin-only, tenant-scoped.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
}

/** `cus_`/`price_` nu spun singure dacă sunt din test — modul se vede doar pe cont. */
async function collect(tenantId: string) {
	const clients = await db
		.select({ id: table.client.id, name: table.client.name, customerId: table.client.stripeCustomerId })
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenantId),
				isNotNull(table.client.stripeCustomerId),
				ne(table.client.stripeCustomerId, '')
			)
		);

	const products = await db
		.select({
			id: table.hostingProduct.id,
			name: table.hostingProduct.name,
			priceId: table.hostingProduct.stripePriceId
		})
		.from(table.hostingProduct)
		.where(
			and(
				eq(table.hostingProduct.tenantId, tenantId),
				isNotNull(table.hostingProduct.stripePriceId),
				ne(table.hostingProduct.stripePriceId, '')
			)
		);

	return { clients, products };
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? 'check';
	const apply = event.url.searchParams.get('apply') === '1';

	try {
		const { clients, products } = await collect(tenantId);

		if (action === 'check') {
			return json({
				clientsWithCustomerId: clients.length,
				productsWithPriceId: products.length,
				sample: {
					clients: clients.slice(0, 5).map((c) => ({ name: c.name, customerId: c.customerId })),
					products: products.map((p) => ({ name: p.name, priceId: p.priceId }))
				},
				hint: 'Rulează ?action=clear pentru dry-run, apoi &apply=1 ca să șteargă.'
			});
		}

		if (action !== 'clear') throw error(400, 'action necunoscut (check | clear)');

		if (!apply) {
			return json({
				dryRun: true,
				wouldClearClients: clients.length,
				wouldClearProducts: products.length,
				note: 'Adaugă &apply=1 ca să execute.'
			});
		}

		// Filtrate pe tenant — un UPDATE fără filtrul ăsta ar goli cache-ul altor tenanți.
		const clearedClients = await db
			.update(table.client)
			.set({ stripeCustomerId: null })
			.where(and(eq(table.client.tenantId, tenantId), isNotNull(table.client.stripeCustomerId)))
			.returning({ id: table.client.id });

		const clearedProducts = await db
			.update(table.hostingProduct)
			.set({ stripePriceId: null })
			.where(
				and(
					eq(table.hostingProduct.tenantId, tenantId),
					isNotNull(table.hostingProduct.stripePriceId)
				)
			)
			.returning({ id: table.hostingProduct.id });

		logInfo('stripe', 'Cache Stripe golit pentru trecerea pe live', {
			tenantId,
			userId: event.locals.user!.id,
			metadata: { clients: clearedClients.length, products: clearedProducts.length }
		});

		return json({
			applied: true,
			clearedClients: clearedClients.length,
			clearedProducts: clearedProducts.length,
			next: 'Schimbă cheile în /settings/stripe, apoi testează o comandă reală.'
		});
	} catch (e) {
		if ((e as { status?: number })?.status) throw e;
		logError('stripe', 'Cleanup go-live eșuat', {
			tenantId,
			metadata: { error: serializeError(e) }
		});
		throw error(500, e instanceof Error ? e.message : 'Cleanup eșuat.');
	}
};
