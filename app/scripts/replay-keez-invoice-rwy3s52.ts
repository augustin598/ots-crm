/**
 * One-off script: inspect and replay missing line items for invoice rwy3s52stmt3rzedikzqk4fz
 * Lost on 2026-05-11 04:59:42 due to "invalid baton" error during sync.
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/lib/server/db/schema';
import { eq, count } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const INVOICE_ID = 'rwy3s52stmt3rzedikzqk4fz';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

async function main() {
	const url = process.env.SQLITE_URI;
	const authToken = process.env.SQLITE_AUTH_TOKEN;
	if (!url) throw new Error('SQLITE_URI not set');

	const client = createClient({ url, authToken });
	const db = drizzle(client, { schema });

	// Step 1: Inspect current state
	console.log('=== BEFORE STATE ===');

	const [invoice] = await db
		.select({
			id: schema.invoice.id,
			tenantId: schema.invoice.tenantId,
			clientId: schema.invoice.clientId,
			keezInvoiceId: schema.invoice.keezInvoiceId,
			keezExternalId: schema.invoice.keezExternalId,
			totalAmount: schema.invoice.totalAmount,
			status: schema.invoice.status,
		})
		.from(schema.invoice)
		.where(eq(schema.invoice.id, INVOICE_ID))
		.limit(1);

	if (!invoice) {
		console.error('ERROR: Invoice not found in DB. Nothing to replay.');
		process.exit(1);
	}

	console.log('Invoice:', JSON.stringify(invoice, null, 2));

	const [lineItemCount] = await db
		.select({ count: count() })
		.from(schema.invoiceLineItem)
		.where(eq(schema.invoiceLineItem.invoiceId, INVOICE_ID));

	console.log('Line items count:', lineItemCount.count);

	if (lineItemCount.count > 0) {
		console.log('Line items already exist — listing them:');
		const existing = await db
			.select()
			.from(schema.invoiceLineItem)
			.where(eq(schema.invoiceLineItem.invoiceId, INVOICE_ID));
		console.log(JSON.stringify(existing, null, 2));
		console.log('STOP: Line items already present, no replay needed.');
		process.exit(0);
	}

	// Step 2: Replay — direct INSERT (strategy B, as force re-sync would pull all pages)
	console.log('\n=== REPLAYING LINE ITEMS (strategy B: direct INSERT) ===');

	const lineItems = [
		{
			id: generateId(),
			invoiceId: INVOICE_ID,
			description: 'Google ADS - Seo / Mentenanta website / Tiktok / Facebook',
			quantity: 1,
			rate: 350000,       // in cents
			amount: 350000,     // in cents
			taxRate: 2100,
			unitOfMeasure: 'Buc',
			note: 'Perioada - ( 01.01.2026 \u2013 31.01.2026 )',
			keezItemExternalId: '3c75e2944e2047765e05c0ca7b9fd3b5',
		},
		{
			id: generateId(),
			invoiceId: INVOICE_ID,
			description: 'Google ADS - Seo / Mentenanta website / Tiktok / Facebook',
			quantity: 1,
			rate: 350000,
			amount: 350000,
			taxRate: 2100,
			unitOfMeasure: 'Buc',
			note: 'Perioada - ( 01.02.2026 \u2013 28.02.2026 )',
			keezItemExternalId: '3c75e2944e2047765e05c0ca7b9fd3b5',
		},
	];

	// Verify tenant scope before any write
	if (invoice.tenantId !== 'ots') {
		console.error(`ERROR: tenantId is '${invoice.tenantId}', expected 'ots'. Aborting for safety.`);
		process.exit(1);
	}

	await db.insert(schema.invoiceLineItem).values(lineItems);
	console.log('Inserted 2 line items.');

	// Step 3: Verify
	console.log('\n=== AFTER STATE ===');
	const inserted = await db
		.select({
			id: schema.invoiceLineItem.id,
			description: schema.invoiceLineItem.description,
			quantity: schema.invoiceLineItem.quantity,
			rate: schema.invoiceLineItem.rate,
			amount: schema.invoiceLineItem.amount,
			taxRate: schema.invoiceLineItem.taxRate,
			note: schema.invoiceLineItem.note,
			unitOfMeasure: schema.invoiceLineItem.unitOfMeasure,
			keezItemExternalId: schema.invoiceLineItem.keezItemExternalId,
		})
		.from(schema.invoiceLineItem)
		.where(eq(schema.invoiceLineItem.invoiceId, INVOICE_ID));

	console.log('Line items after replay:');
	console.log(JSON.stringify(inserted, null, 2));
	console.log(`\nTotal rows: ${inserted.length}`);
}

main().catch((err) => {
	console.error('Script failed:', err);
	process.exit(1);
});
