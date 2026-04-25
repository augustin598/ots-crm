/**
 * Integration test: POST /[tenant]/api/webhooks/whmcs/invoices
 *
 * Covers the full event lifecycle + defenses:
 *   - created → 202 + invoice row + line items + sync INVOICE_CREATED
 *   - created (exact dup) → 200 outcome=dedup
 *   - paid → 202 + invoice.status='paid' + paidDate set
 *   - cancelled → 202 + invoice.status='cancelled'
 *   - paid before created (out-of-order) → DEAD_LETTER (reason: invoice_missing…)
 *   - refunded → DEAD_LETTER (reason: needs_credit_note_creation)
 *   - created then created-with-different-total → DEAD_LETTER (amount_mutation)
 *   - keezSeriesHosting configured → invoice_number uses it
 *   - externalTransactionId persisted + line-item.note carries txn
 *   - malformed JSON / missing whmcsInvoiceId → 400
 *   - no owner/admin user → DEAD_LETTER (reason: no_admin_user_for_tenant)
 *
 * Run:
 *   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-invoices-endpoint.ts
 */
import { and, eq } from 'drizzle-orm';
import { redis } from 'bun';

import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { encrypt } from '../src/lib/server/plugins/smartbill/crypto';
import { signRequest } from '../src/lib/server/whmcs/hmac';
import type { WhmcsInvoicePayload } from '../src/lib/server/whmcs/types';
import { bootstrapTestSchema } from './_test-schema-bootstrap';

import { POST } from '../src/routes/[tenant]/api/webhooks/whmcs/invoices/+server';

await bootstrapTestSchema();

// ─── redis monkey-patch (nonce SETNX) ───────────────────────
const nonceStore = new Set<string>();
const origSend = redis.send.bind(redis);
(redis as unknown as { send: (cmd: string, args: string[]) => Promise<unknown> }).send = async (
	cmd: string,
	args: string[]
) => {
	if (cmd === 'SET' && args.includes('NX')) {
		const key = args[0];
		if (nonceStore.has(key)) return null;
		nonceStore.add(key);
		return 'OK';
	}
	return origSend(cmd, args);
};

// ─── Seed tenant + user + integration + invoice settings ────
const TENANT_ID = 't_invoices_ep';
const TENANT_SLUG = 'invoices-ep';
const SHARED_SECRET = 'd'.repeat(64);
const USER_ID = 'u_admin_invoices';

await db.insert(table.tenant).values({ id: TENANT_ID, name: 'Inv EP', slug: TENANT_SLUG });

await db.insert(table.user).values({
	id: USER_ID,
	email: 'admin@invoices-ep.ro',
	firstName: 'Admin',
	lastName: 'Owner',
	passwordHash: 'x'
} as any);

await db.insert(table.tenantUser).values({
	id: 'tu_invoices_ep',
	tenantId: TENANT_ID,
	userId: USER_ID,
	role: 'owner'
} as any);

await db.insert(table.invoiceSettings).values({
	id: 'is_invoices_ep',
	tenantId: TENANT_ID,
	keezSeries: 'OTS',
	keezSeriesHosting: 'HOST' // dedicated WHMCS series
} as any);

await db.insert(table.whmcsIntegration).values({
	id: 'whmcs_invoices_ep',
	tenantId: TENANT_ID,
	whmcsUrl: 'https://whmcs.example.com',
	sharedSecret: encrypt(TENANT_ID, SHARED_SECRET),
	isActive: true,
	enableKeezPush: false,
	consecutiveFailures: 0
});

// ─── Helpers ────────────────────────────────────────────────
function buildSignedRequest(body: string, secret: string = SHARED_SECRET): Request {
	const ts = Math.floor(Date.now() / 1000);
	const nonce = crypto.randomUUID();
	const pathname = `/${TENANT_SLUG}/api/webhooks/whmcs/invoices`;
	const signature = signRequest(secret, ts, 'POST', pathname, TENANT_SLUG, nonce, body);
	return new Request(`http://localhost${pathname}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-OTS-Timestamp': ts.toString(),
			'X-OTS-Signature': signature,
			'X-OTS-Tenant': TENANT_SLUG,
			'X-OTS-Nonce': nonce
		},
		body
	});
}

function buildEvent(req: Request): any {
	const url = new URL(req.url);
	return { request: req, url, params: { tenant: TENANT_SLUG } };
}

function invoicePayload(overrides: Partial<WhmcsInvoicePayload> = {}): WhmcsInvoicePayload {
	return {
		event: 'created',
		whmcsInvoiceId: 555,
		whmcsInvoiceNumber: 'OTS555',
		issueDate: '2026-04-22',
		dueDate: '2026-05-22',
		status: 'Unpaid',
		subtotal: 80.0,
		tax: 16.8,
		total: 96.8,
		currency: 'RON',
		paymentMethod: 'stripe',
		transactionId: 'txn_3TP2JeHcO0rcngck1pJbyYcu',
		notes: 'Găzduire premium',
		client: {
			event: 'added',
			whmcsClientId: 123,
			taxId: '40015841',
			companyName: 'ONE TOP SOLUTION S.R.L',
			firstName: null,
			lastName: null,
			isLegalPerson: true,
			email: 'office@onetopsolution.ro',
			phone: null,
			address: 'Tineretului 5',
			city: 'Suceava',
			countyCode: 'RO-SV',
			countyName: 'Suceava',
			countryCode: 'RO',
			countryName: 'România',
			postalCode: '720000',
			status: 'Active'
		},
		items: [
			{
				whmcsItemId: 9876,
				externalItemId: 'fae91277bbfe4f28b1bc1328fd0706db',
				description: 'Găzduire web — example.ro',
				quantity: 1,
				unitPrice: 80.0,
				vatPercent: 21
			}
		],
		...overrides
	};
}

// ─── Test runner ────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results: string[] = [];
function assert(name: string, condition: boolean, detail?: string) {
	if (condition) {
		passed++;
		results.push(`  ✅ ${name}`);
	} else {
		failed++;
		results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

// ─────────────────────────────────────────────
// 1. Happy path: created
// ─────────────────────────────────────────────
let createdInvoiceId: string | null = null;
{
	const body = JSON.stringify(invoicePayload());
	const res = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('created: 202', res.status === 202);
	const parsed = await res.json();
	assert('created: outcome=created', parsed.outcome === 'created');
	assert('created: matchType=NEW (no prior CRM client)', parsed.matchType === 'NEW');
	createdInvoiceId = parsed.invoiceId;
	assert('created: invoiceId returned', typeof createdInvoiceId === 'string');
	// PR #29: WHMCS invoice number prefix is stripped before our series is prepended,
	// so "OTS555" → "555" → "HOST 555" (no duplicated OTS).
	assert('created: hosting series used', parsed.invoiceNumber === 'HOST 555');

	const inv = await db.select().from(table.invoice).where(eq(table.invoice.id, createdInvoiceId!)).get();
	assert('created: invoice row exists', inv !== undefined);
	assert('created: externalSource=whmcs', inv?.externalSource === 'whmcs');
	assert('created: externalInvoiceId=555', inv?.externalInvoiceId === 555);
	assert(
		'created: externalTransactionId stored',
		inv?.externalTransactionId === 'txn_3TP2JeHcO0rcngck1pJbyYcu'
	);
	assert('created: status=sent', inv?.status === 'sent');
	assert('created: amount in cents (8000)', inv?.amount === 8000);
	assert('created: totalAmount in cents (9680)', inv?.totalAmount === 9680);
	assert('created: taxAmount in cents (1680)', inv?.taxAmount === 1680);
	assert('created: taxRate basis points (2100 = 21%)', inv?.taxRate === 2100);
	assert('created: currency RON', inv?.currency === 'RON');
	assert('created: invoiceSeries HOST', inv?.invoiceSeries === 'HOST');

	const items = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, createdInvoiceId!));
	assert('created: 1 line item', items.length === 1);
	assert('created: line rate=8000', items[0].rate === 8000);
	assert('created: line amount=8000', items[0].amount === 8000);
	assert(
		'created: line keezItemExternalId carries GUID',
		items[0].keezItemExternalId === 'fae91277bbfe4f28b1bc1328fd0706db'
	);
	assert(
		'created: line note includes Transaction ID',
		items[0].note?.includes('txn_3TP2JeHcO0rcngck1pJbyYcu') === true
	);

	const sync = await db
		.select()
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, TENANT_ID),
				eq(table.whmcsInvoiceSync.whmcsInvoiceId, 555)
			)
		)
		.get();
	assert('created: sync row exists', sync !== undefined);
	assert('created: sync state INVOICE_CREATED', sync?.state === 'INVOICE_CREATED');
	assert('created: sync lastEvent created', sync?.lastEvent === 'created');
	assert('created: sync matchType=NEW', sync?.matchType === 'NEW');
	assert('created: sync originalAmount=96.80', sync?.originalAmount === 96.8);
	assert('created: sync originalCurrency RON', sync?.originalCurrency === 'RON');
	assert('created: sync has originalTotalHash', typeof sync?.originalTotalHash === 'string');
}

// ─────────────────────────────────────────────
// 2. Exact-dup: resend same created payload → dedup
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(invoicePayload());
	const res = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('dedup: 200', res.status === 200);
	const parsed = await res.json();
	assert('dedup: outcome=dedup', parsed.outcome === 'dedup');
	assert('dedup: invoiceId echoed', parsed.invoiceId === createdInvoiceId);

	// Still only one invoice
	const count = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.tenantId, TENANT_ID));
	assert('dedup: still 1 invoice row', count.length === 1);
}

// ─────────────────────────────────────────────
// 3. Paid event
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(invoicePayload({ event: 'paid', status: 'Paid' }));
	const res = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('paid: 202', res.status === 202);
	const parsed = await res.json();
	assert('paid: outcome=updated', parsed.outcome === 'updated');
	assert('paid: event=paid', parsed.event === 'paid');

	const inv = await db.select().from(table.invoice).where(eq(table.invoice.id, createdInvoiceId!)).get();
	assert('paid: invoice.status=paid', inv?.status === 'paid');
	assert('paid: paidDate set', inv?.paidDate !== null);
}

// ─────────────────────────────────────────────
// 4. Cancelled event (on a different invoice to keep prior assertions clean)
// ─────────────────────────────────────────────
{
	const create = invoicePayload({ whmcsInvoiceId: 600, whmcsInvoiceNumber: 'OTS600' });
	await POST(buildEvent(buildSignedRequest(JSON.stringify(create))) as any);

	const cancelBody = invoicePayload({
		event: 'cancelled',
		whmcsInvoiceId: 600,
		whmcsInvoiceNumber: 'OTS600'
	});
	const res = await POST(buildEvent(buildSignedRequest(JSON.stringify(cancelBody))) as any);
	assert('cancelled: 202', res.status === 202);
	const parsed = await res.json();
	assert('cancelled: outcome=updated', parsed.outcome === 'updated');
	assert('cancelled: event=cancelled', parsed.event === 'cancelled');

	const inv = await db
		.select()
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, TENANT_ID),
				eq(table.invoice.externalInvoiceId, 600)
			)
		)
		.get();
	assert('cancelled: invoice.status=cancelled', inv?.status === 'cancelled');
	assert('cancelled: paidDate cleared', inv?.paidDate === null);
}

// ─────────────────────────────────────────────
// 5. Refunded → DEAD_LETTER
// ─────────────────────────────────────────────
{
	const body = invoicePayload({
		event: 'refunded',
		whmcsInvoiceId: 700,
		whmcsInvoiceNumber: 'OTS700'
	});
	const res = await POST(buildEvent(buildSignedRequest(JSON.stringify(body))) as any);
	assert('refunded: 202', res.status === 202);
	const parsed = await res.json();
	assert('refunded: outcome=dead_letter', parsed.outcome === 'dead_letter');
	assert(
		'refunded: reason=needs_credit_note_creation',
		parsed.reason === 'needs_credit_note_creation'
	);

	// No invoice should have been created for 700
	const exists = await db
		.select()
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, TENANT_ID), eq(table.invoice.externalInvoiceId, 700))
		)
		.get();
	assert('refunded: no invoice row created', exists === undefined);

	const sync = await db
		.select()
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, TENANT_ID),
				eq(table.whmcsInvoiceSync.whmcsInvoiceId, 700)
			)
		)
		.get();
	assert('refunded: sync state DEAD_LETTER', sync?.state === 'DEAD_LETTER');
}

// ─────────────────────────────────────────────
// 6. Paid without prior create → SYNTHESIZE invoice with status=paid
//    (historical WHMCS invoices pre-integration)
// ─────────────────────────────────────────────
{
	const body = invoicePayload({
		event: 'paid',
		whmcsInvoiceId: 800,
		whmcsInvoiceNumber: 'OTS800'
	});
	const res = await POST(buildEvent(buildSignedRequest(JSON.stringify(body))) as any);
	assert('synthesized-paid: 202', res.status === 202);
	const parsed = await res.json();
	assert('synthesized-paid: outcome=created', parsed.outcome === 'created');

	const sync = await db
		.select()
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, TENANT_ID),
				eq(table.whmcsInvoiceSync.whmcsInvoiceId, 800)
			)
		)
		.get();
	assert('synthesized-paid: sync state INVOICE_CREATED', sync?.state === 'INVOICE_CREATED');
	assert('synthesized-paid: sync lastEvent=paid (real event)', sync?.lastEvent === 'paid');

	const inv = await db
		.select()
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, TENANT_ID), eq(table.invoice.externalInvoiceId, 800))
		)
		.get();
	assert('synthesized-paid: invoice created', inv !== undefined);
	assert('synthesized-paid: invoice status=paid', inv?.status === 'paid');
	assert('synthesized-paid: paidDate set', inv?.paidDate !== null);
}

// ─────────────────────────────────────────────
// 6b. Cancelled without prior create → SYNTHESIZE with status=cancelled
// ─────────────────────────────────────────────
{
	const body = invoicePayload({
		event: 'cancelled',
		whmcsInvoiceId: 801,
		whmcsInvoiceNumber: 'OTS801'
	});
	const res = await POST(buildEvent(buildSignedRequest(JSON.stringify(body))) as any);
	const parsed = await res.json();
	assert('synthesized-cancelled: outcome=created', parsed.outcome === 'created');

	const inv = await db
		.select()
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, TENANT_ID), eq(table.invoice.externalInvoiceId, 801))
		)
		.get();
	assert('synthesized-cancelled: invoice status=cancelled', inv?.status === 'cancelled');
	assert('synthesized-cancelled: paidDate null', inv?.paidDate === null);
}

// ─────────────────────────────────────────────
// 7. Amount mutation post-create → DEAD_LETTER
// ─────────────────────────────────────────────
{
	// Fresh create at 100 RON total
	const origPayload = invoicePayload({
		whmcsInvoiceId: 900,
		whmcsInvoiceNumber: 'OTS900',
		subtotal: 80,
		tax: 20,
		total: 100,
		items: [
			{
				whmcsItemId: 1,
				externalItemId: 'guid-900',
				description: 'Hosting',
				quantity: 1,
				unitPrice: 80,
				vatPercent: 25
			}
		]
	});
	await POST(buildEvent(buildSignedRequest(JSON.stringify(origPayload))) as any);

	// Attacker/WHMCS edit re-sends `created` with different total
	const mutated = invoicePayload({
		whmcsInvoiceId: 900,
		whmcsInvoiceNumber: 'OTS900',
		subtotal: 160,
		tax: 40,
		total: 200,
		items: [
			{
				whmcsItemId: 1,
				externalItemId: 'guid-900',
				description: 'Hosting',
				quantity: 2, // doubled
				unitPrice: 80,
				vatPercent: 25
			}
		]
	});
	const res = await POST(buildEvent(buildSignedRequest(JSON.stringify(mutated))) as any);
	const parsed = await res.json();
	assert('mutation: outcome=dead_letter', parsed.outcome === 'dead_letter');
	assert(
		'mutation: reason=amount_mutation_post_create',
		parsed.reason === 'amount_mutation_post_create'
	);

	// Invoice is NOT overwritten
	const inv = await db
		.select()
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, TENANT_ID), eq(table.invoice.externalInvoiceId, 900))
		)
		.get();
	assert('mutation: invoice.total preserved (10000)', inv?.totalAmount === 10000);
}

// ─────────────────────────────────────────────
// 8. Malformed JSON → 400
// ─────────────────────────────────────────────
{
	const res = await POST(buildEvent(buildSignedRequest('{not json')) as any);
	assert('malformed JSON: 400', res.status === 400);
	const parsed = await res.json();
	assert('malformed JSON: reason=invalid_json', parsed.reason === 'invalid_json');
}

// ─────────────────────────────────────────────
// 9. Missing whmcsInvoiceId → 400 malformed_payload
// ─────────────────────────────────────────────
{
	const body = JSON.stringify({
		event: 'created',
		currency: 'RON',
		subtotal: 0,
		tax: 0,
		total: 0,
		issueDate: '2026-04-22',
		client: {},
		items: []
	});
	const res = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('missing whmcsInvoiceId: 400', res.status === 400);
	const parsed = await res.json();
	assert('missing whmcsInvoiceId: reason', parsed.reason === 'malformed_payload');
}

// ─────────────────────────────────────────────
// 10. Bad signature → 401
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(invoicePayload({ whmcsInvoiceId: 1001 }));
	const res = await POST(buildEvent(buildSignedRequest(body, 'wrong-secret')) as any);
	assert('bad sig: 401', res.status === 401);
	const parsed = await res.json();
	assert('bad sig: signature_mismatch', parsed.reason === 'signature_mismatch');
}

// ─────────────────────────────────────────────
// 11. No admin user for tenant → DEAD_LETTER no_admin_user_for_tenant
// ─────────────────────────────────────────────
{
	// Create second tenant with integration but NO user
	const T2 = 't_no_admin';
	const SLUG2 = 'no-admin-tenant';
	const SECRET2 = 'e'.repeat(64);
	await db.insert(table.tenant).values({ id: T2, name: 'No Admin', slug: SLUG2 });
	await db.insert(table.whmcsIntegration).values({
		id: 'whmcs_no_admin',
		tenantId: T2,
		whmcsUrl: 'https://whmcs.example.com',
		sharedSecret: encrypt(T2, SECRET2),
		isActive: true,
		enableKeezPush: false,
		consecutiveFailures: 0
	});

	const body = JSON.stringify(invoicePayload({ whmcsInvoiceId: 2000, whmcsInvoiceNumber: 'NA2000' }));
	const ts = Math.floor(Date.now() / 1000);
	const nonce = crypto.randomUUID();
	const pathname = `/${SLUG2}/api/webhooks/whmcs/invoices`;
	const sig = signRequest(SECRET2, ts, 'POST', pathname, SLUG2, nonce, body);
	const req = new Request(`http://localhost${pathname}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-OTS-Timestamp': ts.toString(),
			'X-OTS-Signature': sig,
			'X-OTS-Tenant': SLUG2,
			'X-OTS-Nonce': nonce
		},
		body
	});
	const res = await POST({ request: req, url: new URL(req.url), params: { tenant: SLUG2 } } as any);
	const parsed = await res.json();
	assert(
		'no-admin: outcome=dead_letter',
		parsed.outcome === 'dead_letter'
	);
	assert(
		'no-admin: reason=no_admin_user_for_tenant',
		parsed.reason === 'no_admin_user_for_tenant'
	);
}

// ─────────────────────────────────────────────
console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
