/**
 * Integration tests: WHMCS webhook verification pipeline.
 *
 * Spins up a throwaway SQLite file, creates minimal schema (tenant +
 * whmcs_integration), seeds a realistic tenant, and runs the full
 * verifyWhmcsWebhook orchestrator against a mocked RequestEvent.
 * Redis is monkey-patched to a pure-JS in-memory Set so nonce-replay
 * semantics can be exercised without running a real Redis.
 *
 * Covers:
 *   - Happy path → ok:true, integration loaded, nonce claimed
 *   - Missing headers → missing_signature_headers
 *   - Stale timestamp → stale_timestamp
 *   - Bad timestamp format → invalid_timestamp
 *   - URL ↔ header slug mismatch → tenant_slug_mismatch
 *   - Unknown tenant → tenant_not_found
 *   - Integration inactive → whmcs_integration_inactive
 *   - Circuit breaker in future → circuit_breaker_open
 *   - Bad signature → signature_mismatch
 *   - Same nonce twice → nonce_replay on second attempt
 *   - enableKeezPush=false reflected as dryRun indirectly (health endpoint test)
 *
 * Run: bun run scripts/test-whmcs-verify-webhook.ts
 */

// Environment + DB file are set up by scripts/_test-preload.ts (SQLITE_PATH,
// ENCRYPTION_SECRET). Run via:
//   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-verify-webhook.ts

import { unlinkSync } from 'fs';
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { encrypt } from '../src/lib/server/plugins/smartbill/crypto';
import { signRequest } from '../src/lib/server/whmcs/hmac';
import { verifyWhmcsWebhook } from '../src/lib/server/whmcs/verify-webhook';
import { redis } from 'bun';

// ─────────────────────────────────────────────
// Bootstrap schema (minimal — just what verify-webhook touches)
// ─────────────────────────────────────────────

// Full tenant schema from schema.ts — Drizzle SELECT expands to every declared
// column so the physical table must match shape exactly.
await db.run(sql`CREATE TABLE IF NOT EXISTS tenant (
	id text PRIMARY KEY NOT NULL,
	name text NOT NULL,
	slug text NOT NULL UNIQUE,
	website text,
	company_type text,
	cui text,
	registration_number text,
	trade_register text,
	vat_number text,
	legal_representative text,
	iban text,
	iban_euro text,
	bank_name text,
	address text,
	city text,
	county text,
	postal_code text,
	country text DEFAULT 'România',
	phone text,
	email text,
	contract_prefix text DEFAULT 'CTR',
	theme_color text,
	favicon text,
	created_at timestamp DEFAULT current_date NOT NULL,
	updated_at timestamp DEFAULT current_date NOT NULL
)`);

await db.run(sql`CREATE TABLE IF NOT EXISTS whmcs_integration (
	id text PRIMARY KEY,
	tenant_id text NOT NULL REFERENCES tenant(id),
	whmcs_url text NOT NULL,
	shared_secret text NOT NULL,
	is_active integer NOT NULL DEFAULT 0,
	enable_keez_push integer NOT NULL DEFAULT 0,
	circuit_breaker_until timestamp,
	consecutive_failures integer NOT NULL DEFAULT 0,
	last_successful_sync_at timestamp,
	last_failure_reason text,
	created_at timestamp NOT NULL DEFAULT current_date,
	updated_at timestamp NOT NULL DEFAULT current_date
)`);
await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS whmcs_integration_tenant_unique ON whmcs_integration(tenant_id)`);

// ─────────────────────────────────────────────
// Monkey-patch redis — cheap in-memory SETNX
// ─────────────────────────────────────────────

const nonceStore = new Set<string>();
const originalRedisSend = redis.send.bind(redis);
(redis as unknown as { send: (cmd: string, args: string[]) => Promise<unknown> }).send = async (
	cmd: string,
	args: string[]
): Promise<unknown> => {
	if (cmd === 'SET' && args.includes('NX')) {
		const key = args[0];
		if (nonceStore.has(key)) return null; // NX failed → already exists
		nonceStore.add(key);
		return 'OK';
	}
	// Fallthrough for anything else (should be nothing in this test).
	return originalRedisSend(cmd, args);
};

// ─────────────────────────────────────────────
// Seed a tenant + integration
// ─────────────────────────────────────────────

const TENANT_ID = 'ten_test';
const TENANT_SLUG = 'ots-test';
const SHARED_SECRET = 'a'.repeat(64);

await db.insert(table.tenant).values({
	id: TENANT_ID,
	name: 'Test Tenant S.R.L.',
	slug: TENANT_SLUG
});

const INTEGRATION_ID = 'whmcs_test_1';
await db.insert(table.whmcsIntegration).values({
	id: INTEGRATION_ID,
	tenantId: TENANT_ID,
	whmcsUrl: 'https://whmcs.example.com',
	sharedSecret: encrypt(TENANT_ID, SHARED_SECRET),
	isActive: true,
	enableKeezPush: false,
	consecutiveFailures: 0
});

// ─────────────────────────────────────────────
// Helpers — build a mock RequestEvent
// ─────────────────────────────────────────────

interface MockEventInput {
	method?: string;
	pathname?: string;
	tenantParam?: string;
	headers?: Record<string, string>;
}

function buildEvent(input: MockEventInput = {}): any {
	const method = input.method ?? 'GET';
	const pathname = input.pathname ?? `/${input.tenantParam ?? TENANT_SLUG}/api/webhooks/whmcs/health`;
	const hdrs = new Headers(input.headers ?? {});

	return {
		request: {
			method,
			headers: hdrs
		},
		url: { pathname },
		params: { tenant: input.tenantParam ?? TENANT_SLUG }
	};
}

function signHeaders(options: {
	ts?: number;
	method?: string;
	pathname?: string;
	tenantSlug?: string;
	nonce?: string;
	body?: string;
	secret?: string;
}): Record<string, string> {
	const ts = options.ts ?? Math.floor(Date.now() / 1000);
	const method = options.method ?? 'GET';
	const pathname = options.pathname ?? `/${TENANT_SLUG}/api/webhooks/whmcs/health`;
	const slug = options.tenantSlug ?? TENANT_SLUG;
	const nonce = options.nonce ?? crypto.randomUUID();
	const body = options.body ?? '';
	const secret = options.secret ?? SHARED_SECRET;
	return {
		'X-OTS-Timestamp': ts.toString(),
		'X-OTS-Signature': signRequest(secret, ts, method, pathname, slug, nonce, body),
		'X-OTS-Tenant': slug,
		'X-OTS-Nonce': nonce
	};
}

// ─────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────

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
// 1. Happy path
// ─────────────────────────────────────────────

{
	const headers = signHeaders({});
	const event = buildEvent({ headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('happy: ok=true', result.ok === true);
	if (result.ok) {
		assert('happy: tenant.slug matches', result.tenant.slug === TENANT_SLUG);
		assert('happy: integration.id matches', result.integration.id === INTEGRATION_ID);
		assert('happy: integration.isActive', result.integration.isActive === true);
		assert('happy: integration.enableKeezPush false (dry-run)', result.integration.enableKeezPush === false);
	}
}

// ─────────────────────────────────────────────
// 2. Missing headers
// ─────────────────────────────────────────────

{
	const event = buildEvent({ headers: { 'X-OTS-Timestamp': '123' } }); // missing others
	const result = await verifyWhmcsWebhook(event, '');
	assert('missing headers: rejected', !result.ok);
	if (!result.ok) {
		assert('missing headers: reason', result.reason === 'missing_signature_headers');
		assert('missing headers: 401', result.statusCode === 401);
	}
}

// ─────────────────────────────────────────────
// 3. Invalid timestamp format
// ─────────────────────────────────────────────

{
	const headers = signHeaders({});
	headers['X-OTS-Timestamp'] = 'not-a-number';
	const event = buildEvent({ headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('invalid ts format: rejected', !result.ok && (result as any).reason === 'invalid_timestamp');
}

// ─────────────────────────────────────────────
// 4. Stale timestamp (>65s old)
// ─────────────────────────────────────────────

{
	const headers = signHeaders({ ts: Math.floor(Date.now() / 1000) - 120 });
	const event = buildEvent({ headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('stale ts: rejected', !result.ok && (result as any).reason === 'stale_timestamp');
}

// ─────────────────────────────────────────────
// 5. URL ↔ header slug mismatch
// ─────────────────────────────────────────────

{
	// Sign with TENANT_SLUG but URL param has different slug
	const headers = signHeaders({ tenantSlug: TENANT_SLUG });
	const event = buildEvent({ tenantParam: 'other-slug', headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('url slug mismatch: rejected', !result.ok && (result as any).reason === 'tenant_slug_mismatch');
}

// ─────────────────────────────────────────────
// 6. Unknown tenant (valid HMAC-looking request but slug not in DB)
// ─────────────────────────────────────────────

{
	const unknownSlug = 'ghost-tenant-xyz';
	const headers = signHeaders({ tenantSlug: unknownSlug });
	const event = buildEvent({ tenantParam: unknownSlug, headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('unknown tenant: rejected', !result.ok && (result as any).reason === 'tenant_not_found');
}

// ─────────────────────────────────────────────
// 7. Integration inactive
// ─────────────────────────────────────────────

{
	// Flip inactive, then flip back after test
	await db.update(table.whmcsIntegration).set({ isActive: false }).where(sql`id = ${INTEGRATION_ID}`);

	const headers = signHeaders({});
	const event = buildEvent({ headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('inactive: rejected', !result.ok && (result as any).reason === 'whmcs_integration_inactive');

	await db.update(table.whmcsIntegration).set({ isActive: true }).where(sql`id = ${INTEGRATION_ID}`);
}

// ─────────────────────────────────────────────
// 8. Circuit breaker open
// ─────────────────────────────────────────────

{
	const future = new Date(Date.now() + 10 * 60 * 1000); // 10 min ahead
	await db.update(table.whmcsIntegration).set({ circuitBreakerUntil: future }).where(sql`id = ${INTEGRATION_ID}`);

	const headers = signHeaders({});
	const event = buildEvent({ headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('circuit breaker: rejected', !result.ok && (result as any).reason === 'circuit_breaker_open');
	assert('circuit breaker: 503 status', (result as any).statusCode === 503);

	await db.update(table.whmcsIntegration).set({ circuitBreakerUntil: null }).where(sql`id = ${INTEGRATION_ID}`);
}

// ─────────────────────────────────────────────
// 9. Bad signature (wrong secret)
// ─────────────────────────────────────────────

{
	const headers = signHeaders({ secret: 'wrong-secret' });
	const event = buildEvent({ headers });
	const result = await verifyWhmcsWebhook(event, '');
	assert('bad signature: rejected', !result.ok && (result as any).reason === 'signature_mismatch');
}

// ─────────────────────────────────────────────
// 10. Nonce replay (same nonce twice)
// ─────────────────────────────────────────────

{
	const fixedNonce = crypto.randomUUID();

	// First request with this nonce — should succeed
	const h1 = signHeaders({ nonce: fixedNonce });
	const e1 = buildEvent({ headers: h1 });
	const r1 = await verifyWhmcsWebhook(e1, '');
	assert('replay: first call ok', r1.ok === true);

	// Second request with SAME nonce but fresh timestamp — should be rejected as replay.
	// We sign with a new timestamp so timestamp-window doesn't reject it first.
	const h2 = signHeaders({ nonce: fixedNonce, ts: Math.floor(Date.now() / 1000) + 1 });
	const e2 = buildEvent({ headers: h2 });
	const r2 = await verifyWhmcsWebhook(e2, '');
	assert('replay: second call rejected', !r2.ok && (r2 as any).reason === 'nonce_replay');
}

// ─────────────────────────────────────────────
// 11. POST with body — rawBody must match signed body
// ─────────────────────────────────────────────

{
	const body = JSON.stringify({
		event: 'created',
		whmcsInvoiceId: 555,
		client: { taxId: '40015841', companyName: 'ONE TOP SOLUTION S.R.L' },
		transactionId: 'txn_3TP2JeHcO0rcngck1pJbyYcu'
	});
	const pathname = `/${TENANT_SLUG}/api/webhooks/whmcs/invoices`;
	const headers = signHeaders({ method: 'POST', pathname, body });
	const event = buildEvent({ method: 'POST', pathname, headers });

	// Matching body → ok
	const r1 = await verifyWhmcsWebhook(event, body);
	assert('POST with body (matching): ok', r1.ok === true);

	// Mutated body → signature mismatch (use a fresh nonce since the first one is now claimed)
	const headers2 = signHeaders({ method: 'POST', pathname, body });
	const event2 = buildEvent({ method: 'POST', pathname, headers: headers2 });
	const tampered = body.replace('555', '666');
	const r2 = await verifyWhmcsWebhook(event2, tampered);
	assert('POST with body (tampered): rejected', !r2.ok && (r2 as any).reason === 'signature_mismatch');
}

// ─────────────────────────────────────────────
// Cleanup + report
// ─────────────────────────────────────────────

try { unlinkSync(process.env.SQLITE_PATH!); } catch {}

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
