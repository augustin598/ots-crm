/**
 * Replay a WHMCS "paid" webhook against the LOCAL dev CRM. Reads the actual
 * tenant + WHMCS integration from the dev DB and signs the request with the
 * real shared secret, so the webhook is processed end-to-end (handler →
 * synthesize invoice → triggerAutoPushKeez → real Keez API).
 *
 * Usage:
 *   bun run scripts/replay-whmcs-paid-local.ts
 *
 * Optional env:
 *   CRM_BASE_URL  — override target (default http://localhost:5173)
 *   TENANT_SLUG   — pick a specific tenant by slug (default: first active
 *                   WHMCS integration found)
 *   DESC1         — line-item 1 description (default below)
 *   DESC2         — line-item 2 description (omit to send a single line)
 *   TXN_ID        — transactionId
 */
import { eq, and } from 'drizzle-orm';

import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { decrypt } from '../src/lib/server/plugins/smartbill/crypto';
import { signRequest } from '../src/lib/server/whmcs/hmac';
import type { WhmcsInvoicePayload } from '../src/lib/server/whmcs/types';

const CRM_BASE_URL = process.env.CRM_BASE_URL || 'http://localhost:5173';
const desiredSlug = process.env.TENANT_SLUG || null;

// Pick the requested tenant (or the first one with an active WHMCS integration).
const integrations = await db
	.select({
		integration: table.whmcsIntegration,
		tenant: table.tenant
	})
	.from(table.whmcsIntegration)
	.innerJoin(table.tenant, eq(table.whmcsIntegration.tenantId, table.tenant.id))
	.where(eq(table.whmcsIntegration.isActive, true));

if (integrations.length === 0) {
	console.error('No active WHMCS integration found in DB. Aborting.');
	process.exit(1);
}

const picked = desiredSlug
	? integrations.find((row) => row.tenant.slug === desiredSlug)
	: integrations[0];

if (!picked) {
	console.error(
		`No WHMCS integration for slug=${desiredSlug}. Available: ${integrations
			.map((r) => r.tenant.slug)
			.join(', ')}`
	);
	process.exit(1);
}

const { integration, tenant } = picked;
console.log(
	`→ Replaying against tenant "${tenant.slug}" (id=${tenant.id}) integration ${integration.id}`
);
console.log(`  enableKeezPush=${integration.enableKeezPush}`);

let sharedSecret: string;
try {
	sharedSecret = decrypt(tenant.id, integration.sharedSecret);
} catch (err) {
	console.error('Failed to decrypt WHMCS shared secret:', err);
	process.exit(1);
}

// Generate a unique whmcsInvoiceId so we never collide with prior tests.
const whmcsInvoiceId = Date.now() % 1000000; // rotating, unique-ish
const whmcsInvoiceNumber = `OTS${whmcsInvoiceId}`;

const desc1 =
	process.env.DESC1 ||
	`REPLAY-${Date.now().toString(36)} Hosting WordPress anual exemplu.ro`;
const desc2Raw = process.env.DESC2;
const desc2 = desc2Raw ?? `REPLAY-${Date.now().toString(36)} SSL certificate exemplu.ro`;
const txnId = process.env.TXN_ID || `replay-tx-${Date.now()}`;

const items = [
	{
		whmcsItemId: 1,
		externalItemId: '04c73804ad33d48ee879889047d99d43', // intentionally same MD5 GUID that triggered the original bug
		description: desc1,
		quantity: 1,
		unitPrice: 50.0,
		vatPercent: 21
	}
];
if (desc2Raw !== '' && desc2) {
	items.push({
		whmcsItemId: 2,
		externalItemId: 'fae91277bbfe4f28b1bc1328fd0706db',
		description: desc2,
		quantity: 1,
		unitPrice: 50.0,
		vatPercent: 21
	});
}

const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
const tax = Math.round(subtotal * 0.21 * 100) / 100;
const total = subtotal + tax;

const payload: WhmcsInvoicePayload = {
	event: 'paid',
	whmcsInvoiceId,
	whmcsInvoiceNumber,
	issueDate: new Date().toISOString().slice(0, 10),
	dueDate: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
	status: 'Paid',
	subtotal,
	tax,
	total,
	currency: 'RON',
	paymentMethod: 'stripe',
	transactionId: txnId,
	notes: 'Replay test',
	client: {
		event: 'updated',
		whmcsClientId: 9001,
		taxId: '50380607',
		companyName: 'HEY PREMIUM S.R.L.',
		firstName: null,
		lastName: null,
		isLegalPerson: true,
		email: 'office@onetopsolution.ro',
		phone: null,
		address: 'STR. 14 OCTOMBRIE, NR.91',
		city: 'TÂRGU JIU',
		countyCode: 'RO-GJ',
		countyName: 'Gorj',
		countryCode: 'RO',
		countryName: 'România',
		postalCode: null,
		status: 'Active'
	},
	items
};

const body = JSON.stringify(payload);
const ts = Math.floor(Date.now() / 1000);
const nonce = crypto.randomUUID();
const pathname = `/${tenant.slug}/api/webhooks/whmcs/invoices`;
const signature = signRequest(sharedSecret, ts, 'POST', pathname, tenant.slug, nonce, body);

console.log(`→ POST ${CRM_BASE_URL}${pathname}`);
console.log(`  whmcsInvoiceId=${whmcsInvoiceId} desc1=${desc1}${desc2 ? ` desc2=${desc2}` : ''}`);
console.log(`  txnId=${txnId} total=${total}`);

const res = await fetch(`${CRM_BASE_URL}${pathname}`, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'X-OTS-Timestamp': ts.toString(),
		'X-OTS-Signature': signature,
		'X-OTS-Tenant': tenant.slug,
		'X-OTS-Nonce': nonce
	},
	body
});

const responseText = await res.text();
console.log(`← ${res.status} ${responseText}`);

// Wait briefly so the fire-and-forget triggerAutoPushKeez has time to log
// before the script exits — the dev server's flushLogBuffer runs on a timer.
await new Promise((r) => setTimeout(r, 8000));

// Locate the synthesized invoice + recent trace logs and dump them.
let parsed: { invoiceId?: string } = {};
try {
	parsed = JSON.parse(responseText);
} catch {
	/* empty */
}

if (parsed.invoiceId) {
	const recentLogs = await db
		.select()
		.from(table.debugLog)
		.where(
			and(
				eq(table.debugLog.tenantId, tenant.id),
				eq(table.debugLog.action, 'whmcs_keez_trace')
			)
		)
		.orderBy(table.debugLog.createdAt)
		.limit(50);

	const matching = recentLogs
		.filter((row) => {
			try {
				const md = row.metadata ? JSON.parse(row.metadata) : {};
				return md.invoiceId === parsed.invoiceId;
			} catch {
				return false;
			}
		})
		.slice(-20);

	console.log(`\n── trace for invoiceId=${parsed.invoiceId} ──`);
	for (const log of matching) {
		console.log(
			`  [${log.level.toUpperCase()}] ${log.createdAt.toISOString().slice(11, 19)} ${log.message}`
		);
		if (log.metadata) {
			try {
				const md = JSON.parse(log.metadata);
				const printable = { ...md, invoiceId: undefined };
				console.log(`         ${JSON.stringify(printable)}`);
			} catch {
				/* empty */
			}
		}
	}

	if (matching.length === 0) {
		console.log(
			'  (no trace rows for this invoice yet — server may still be writing logs, or the running server has the OLD code)'
		);
	}
}

process.exit(0);
