import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';
import { logWarning, serializeError } from '$lib/server/logger';

/**
 * Lazy-create Stripe Product + Price for a CRM hostingProduct.
 *
 * Strategy:
 *  - First check `hostingProduct.stripePriceId` cache.
 *  - If missing, create Product + Price in Stripe.
 *  - Cache both IDs in DB for subsequent checkouts.
 *
 * Notes on immutability:
 *  - Stripe Prices are IMMUTABLE (cannot change amount/currency after create).
 *  - If admin changes price in CRM, we DETECT mismatch and create a new Price,
 *    archiving the old one. The Product (template) stays the same.
 *
 * Returns the Stripe Price ID (price_...).
 */
export async function getOrCreateStripePrice(
	tenantId: string,
	productRow: {
		id: string;
		name: string;
		description: string | null;
		price: number; // cents
		currency: string;
		billingCycle: string; // monthly | quarterly | annually | etc.
		stripePriceId: string | null;
		stripeProductId: string | null;
	}
): Promise<string> {
	const stripe = await getStripeForTenant(tenantId);

	// 1. Determine Stripe Product ID (lazy create)
	let productId = productRow.stripeProductId;
	if (!productId) {
		const created = await stripe.products.create({
			name: productRow.name,
			description: productRow.description ?? undefined,
			metadata: { crmHostingProductId: productRow.id }
		});
		productId = created.id;
		await db
			.update(table.hostingProduct)
			.set({ stripeProductId: productId, updatedAt: new Date() })
			.where(eq(table.hostingProduct.id, productRow.id));
	}

	// 2. Determine Stripe Price ID
	if (productRow.stripePriceId) {
		// Verify it still matches current CRM price (admin might have changed it)
		try {
			const existing = await stripe.prices.retrieve(productRow.stripePriceId);
			const currencyMatch = existing.currency.toUpperCase() === productRow.currency.toUpperCase();
			const amountMatch = existing.unit_amount === productRow.price;
			const intervalMatch = stripeIntervalMatches(existing, productRow.billingCycle);
			if (currencyMatch && amountMatch && intervalMatch && existing.active) {
				return productRow.stripePriceId;
			}
			// Mismatch → archive old Price, create new one below
			logWarning(
				'directadmin',
				`Stripe Price mismatch detected (currency=${currencyMatch} amount=${amountMatch} interval=${intervalMatch} active=${existing.active}) — archiving old, creating new`,
				{
					metadata: {
						crmHostingProductId: productRow.id,
						oldStripePriceId: productRow.stripePriceId
					}
				}
			);
			await stripe.prices.update(productRow.stripePriceId, { active: false });
		} catch (err) {
			const { message } = serializeError(err);
			logWarning(
				'directadmin',
				`Stripe Price retrieve failed (likely deleted in Dashboard), creating new: ${message}`,
				{
					metadata: {
						crmHostingProductId: productRow.id,
						oldStripePriceId: productRow.stripePriceId
					}
				}
			);
		}
	}

	// 3. Create new Price
	const interval = toStripeInterval(productRow.billingCycle);
	const created = await stripe.prices.create({
		product: productId,
		unit_amount: productRow.price,
		currency: productRow.currency.toLowerCase(),
		recurring: interval
			? { interval: interval.unit, interval_count: interval.count }
			: undefined,
		// `tax_behavior: 'exclusive'` = prețul afișat NU include TVA (Stripe adaugă
		// dacă tax e calculat). Asta corespunde alegerii noastre: afișăm prețuri
		// nete în portal, TVA se adaugă la checkout.
		tax_behavior: 'exclusive',
		metadata: { crmHostingProductId: productRow.id, billingCycle: productRow.billingCycle }
	});

	await db
		.update(table.hostingProduct)
		.set({ stripePriceId: created.id, updatedAt: new Date() })
		.where(eq(table.hostingProduct.id, productRow.id));

	return created.id;
}

interface BillingInterval {
	unit: 'day' | 'week' | 'month' | 'year';
	count: number;
}

function toStripeInterval(billingCycle: string): BillingInterval | null {
	switch (billingCycle) {
		case 'monthly':
			return { unit: 'month', count: 1 };
		case 'quarterly':
			return { unit: 'month', count: 3 };
		case 'semiannually':
		case 'biannually':
			return { unit: 'month', count: 6 };
		case 'annually':
			return { unit: 'year', count: 1 };
		case 'biennially':
			return { unit: 'year', count: 2 };
		case 'triennially':
			return { unit: 'year', count: 3 };
		case 'one_time':
			return null;
		default:
			return { unit: 'month', count: 1 };
	}
}

function stripeIntervalMatches(
	stripePrice: { recurring: { interval: string; interval_count: number } | null },
	billingCycle: string
): boolean {
	const target = toStripeInterval(billingCycle);
	if (!target && !stripePrice.recurring) return true; // one_time match
	if (!target || !stripePrice.recurring) return false;
	return (
		stripePrice.recurring.interval === target.unit &&
		stripePrice.recurring.interval_count === target.count
	);
}
