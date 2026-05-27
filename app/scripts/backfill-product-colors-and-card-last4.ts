#!/usr/bin/env bun
/**
 * One-shot backfill for the May 2026 Hosting Orders v3 redesign:
 *
 *  1. `hosting_product.color` — map known plan names (standard, pro, premium,
 *     extreme) to brand hex colors. Rows already customised (color != default
 *     #1877F2) are left alone.
 *  2. `hosting_inquiry.card_last4` — for paid Stripe inquiries that lack a
 *     last4 (anything created before the webhook patch in Task 5), retrieve
 *     the PaymentIntent with `expand: ['latest_charge']` and persist the
 *     last4. Skips inquiries that don't have a `pi_*` payment_reference, and
 *     inquiries already populated.
 *
 * Run: `cd app && bun run scripts/backfill-product-colors-and-card-last4.ts`
 *
 * Idempotent — second run prints "updated 0 rows" for both passes.
 *
 * Self-contained: uses @libsql/client + Stripe SDK directly so it doesn't
 * pull in $env / $lib (same pattern as backfill-hosting-order-numbers-and-items.ts).
 */
import { createClient } from '@libsql/client';
import Stripe from 'stripe';

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI not set. Source .env first: `set -a && source .env && set +a`');
	process.exit(1);
}
if (!env.STRIPE_SECRET_KEY) {
	console.error(
		'STRIPE_SECRET_KEY not set — required for card_last4 backfill. Source .env first.'
	);
	process.exit(1);
}

const db = createClient({
	url: env.SQLITE_URI,
	authToken: env.SQLITE_AUTH_TOKEN
});

// Match the apiVersion used by src/lib/server/plugins/stripe/factory.ts so the
// charge / payment_method_details shapes line up with the SDK types.
const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
	apiVersion: '2026-04-22.dahlia'
});

// Plan-name → hex color map. Keys match `hosting_product.name` lowercased +
// trimmed. Anything not in this map is left at the default.
const PLAN_COLORS: Record<string, string> = {
	standard: '#64748b',
	pro: '#1877F2',
	premium: '#0d5cc7',
	extreme: '#7c3aed'
};

async function backfillProductColors(): Promise<void> {
	const products = await db.execute(
		"SELECT id, name, color FROM hosting_product WHERE color = '#1877F2'"
	);

	let updated = 0;
	for (const p of products.rows) {
		const key = String(p.name ?? '').toLowerCase().trim();
		const color = PLAN_COLORS[key];
		// Skip if no entry OR mapping resolves to the same default (no-op).
		if (!color || color === '#1877F2') continue;

		await db.execute({
			sql: 'UPDATE hosting_product SET color = ?, updated_at = current_timestamp WHERE id = ?',
			args: [color, p.id as string]
		});
		updated += 1;
	}

	console.log(`[backfill] hosting_product.color: updated ${updated} rows`);
}

async function backfillCardLast4(): Promise<void> {
	const rows = await db.execute(
		"SELECT id, payment_reference FROM hosting_inquiry " +
			"WHERE card_last4 IS NULL " +
			"AND payment_status = 'paid' " +
			"AND payment_reference LIKE 'pi_%'"
	);

	let updated = 0;
	let skipped = 0;
	for (const r of rows.rows) {
		const piId = r.payment_reference as string;
		try {
			const pi = await stripe.paymentIntents.retrieve(piId, {
				expand: ['latest_charge']
			});
			const charge =
				pi.latest_charge && typeof pi.latest_charge === 'object'
					? (pi.latest_charge as Stripe.Charge)
					: null;
			const last4 = charge?.payment_method_details?.card?.last4 ?? null;
			if (!last4) {
				skipped += 1;
				continue;
			}
			await db.execute({
				sql: 'UPDATE hosting_inquiry SET card_last4 = ?, updated_at = current_timestamp WHERE id = ?',
				args: [last4, r.id as string]
			});
			updated += 1;
		} catch (e) {
			console.warn(`[backfill] PI ${piId} failed:`, (e as Error).message);
			skipped += 1;
		}
	}

	console.log(`[backfill] hosting_inquiry.card_last4: updated ${updated}, skipped ${skipped}`);
}

async function main(): Promise<void> {
	await backfillProductColors();
	await backfillCardLast4();
	console.log('[backfill] done');
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
