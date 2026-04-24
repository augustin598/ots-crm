/**
 * Integration test: POST /[tenant]/api/webhooks/whmcs/clients
 *
 * Exercises the endpoint as a whole — verifyWhmcsWebhook + matchOrCreateClient
 * + whmcs_client_sync upsert + response shape. Imports the POST handler
 * directly; `$lib` is resolved by the preload script.
 *
 * Covers:
 *   - Happy path: new WHMCS client → creates CRM client + sync row, 202
 *   - Dedup: re-send same payload → 200 ok=true dedup=true, no duplicate row
 *   - Update after match: 2nd payload with same whmcsClientId but different
 *     hash → updates sync row (hash + processed_at move)
 *   - Matching an existing Keez-imported client by CUI → matchType=CUI,
 *     CRM row's whmcs_client_id stamped
 *   - Malformed JSON body → 400 invalid_json
 *   - Malformed payload shape (missing whmcsClientId) → 400 malformed_payload
 *   - Bad signature → 401 signature_mismatch (verify-webhook already tested,
 *     we just confirm the endpoint wires through)
 *
 * Run:
 *   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-clients-endpoint.ts
 */
import { and, eq } from 'drizzle-orm';
import { redis } from 'bun';
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { encrypt } from '../src/lib/server/plugins/smartbill/crypto';
import { signRequest } from '../src/lib/server/whmcs/hmac';
import type { WhmcsClientPayload } from '../src/lib/server/whmcs/types';
import { bootstrapTestSchema } from './_test-schema-bootstrap';

// Load endpoint via `$lib`-compatible path through preload resolver
import { POST } from '../src/routes/[tenant]/api/webhooks/whmcs/clients/+server';

await bootstrapTestSchema();

// ─────────────────────────────────────────────
// Monkey-patch redis (same approach as verify-webhook test)
// ─────────────────────────────────────────────
const nonceStore = new Set<string>();
const origSend = redis.send.bind(redis);
(redis as unknown as { send: (cmd: string, args: string[]) => Promise<unknown> }).send = async (
	cmd: string,
	args: string[]
): Promise<unknown> => {
	if (cmd === 'SET' && args.includes('NX')) {
		const key = args[0];
		if (nonceStore.has(key)) return null;
		nonceStore.add(key);
		return 'OK';
	}
	return origSend(cmd, args);
};

// ─────────────────────────────────────────────
// Seed tenant + integration
// ─────────────────────────────────────────────
const TENANT_ID = 't_endpoint_clients';
const TENANT_SLUG = 'endpoint-clients';
const SHARED_SECRET = 'c'.repeat(64);

await db.insert(table.tenant).values({ id: TENANT_ID, name: 'EP Clients', slug: TENANT_SLUG });

const INTEGRATION_ID = 'whmcs_ep_clients';
await db.insert(table.whmcsIntegration).values({
	id: INTEGRATION_ID,
	tenantId: TENANT_ID,
	whmcsUrl: 'https://whmcs.example.com',
	sharedSecret: encrypt(TENANT_ID, SHARED_SECRET),
	isActive: true,
	enableKeezPush: false,
	consecutiveFailures: 0
});

// Seed an existing Keez-imported client for the CUI-match branch
await db.insert(table.client).values({
	id: 'seed-keez-client',
	tenantId: TENANT_ID,
	name: 'ONE TOP SOLUTION S.R.L',
	businessName: 'ONE TOP SOLUTION S.R.L',
	cui: '40015841',
	email: null,
	avatarSource: 'whatsapp',
	whmcsClientId: null,
	status: 'active'
} as any);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function buildSignedRequest(body: string, opts: { secret?: string; nonce?: string } = {}): Request {
	const ts = Math.floor(Date.now() / 1000);
	const nonce = opts.nonce ?? crypto.randomUUID();
	const pathname = `/${TENANT_SLUG}/api/webhooks/whmcs/clients`;
	const method = 'POST';
	const secret = opts.secret ?? SHARED_SECRET;
	const signature = signRequest(secret, ts, method, pathname, TENANT_SLUG, nonce, body);
	return new Request(`http://localhost${pathname}`, {
		method,
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

function buildEvent(request: Request): any {
	const url = new URL(request.url);
	return {
		request,
		url,
		params: { tenant: TENANT_SLUG }
	};
}

function basePayload(overrides: Partial<WhmcsClientPayload> = {}): WhmcsClientPayload {
	return {
		event: 'added',
		whmcsClientId: 501,
		taxId: '40015841', // matches seeded client
		companyName: 'ONE TOP SOLUTION S.R.L',
		firstName: 'Augustin',
		lastName: 'C',
		isLegalPerson: true,
		email: 'office@onetopsolution.ro',
		phone: '+40700000000',
		address: 'Tineretului 5',
		city: 'Suceava',
		countyCode: 'RO-SV',
		countyName: 'Suceava',
		countryCode: 'RO',
		countryName: 'România',
		postalCode: '720000',
		status: 'Active',
		...overrides
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
// 1. Happy path — CUI match on seeded Keez client
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(basePayload());
	const response = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('CUI happy: 202 accepted', response.status === 202);

	const parsed = await response.json();
	assert('CUI happy: ok=true', parsed.ok === true);
	assert('CUI happy: matchType=CUI', parsed.matchType === 'CUI');
	assert('CUI happy: action=matched', parsed.action === 'matched');
	assert('CUI happy: clientId points to seeded row', parsed.clientId === 'seed-keez-client');

	// whmcs_client_id stamped on CRM client
	const clientRow = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, 'seed-keez-client'))
		.get();
	assert('CUI happy: whmcs_client_id stamped', clientRow?.whmcsClientId === 501);

	// Sync row persisted
	const sync = await db
		.select()
		.from(table.whmcsClientSync)
		.where(
			and(
				eq(table.whmcsClientSync.tenantId, TENANT_ID),
				eq(table.whmcsClientSync.whmcsClientId, 501)
			)
		)
		.get();
	assert('CUI happy: whmcs_client_sync row exists', sync !== undefined);
	assert('CUI happy: sync state=MATCHED', sync?.state === 'MATCHED');
	assert('CUI happy: sync matchType=CUI', sync?.matchType === 'CUI');
	assert('CUI happy: sync has raw_payload', (sync?.rawPayload?.length ?? 0) > 0);
	assert('CUI happy: sync processedAt set', sync?.processedAt !== null);
}

// ─────────────────────────────────────────────
// 2. Dedup — resend same payload → 200 no-op, no duplicate rows
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(basePayload());
	const response = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('dedup: 200 ok', response.status === 200);
	const parsed = await response.json();
	assert('dedup: ok=true', parsed.ok === true);
	assert('dedup: dedup=true', parsed.dedup === true);
	assert('dedup: matchType echoed', parsed.matchType === 'CUI');

	// No extra rows
	const clients = await db
		.select()
		.from(table.client)
		.where(eq(table.client.tenantId, TENANT_ID));
	assert('dedup: still 1 client row', clients.length === 1);
}

// ─────────────────────────────────────────────
// 3. Update after match — same whmcsClientId, different payload (phone changed)
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(basePayload({ event: 'updated', phone: '+40799999999' }));
	const response = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('update: 202', response.status === 202);
	const parsed = await response.json();
	assert('update: not dedup (payload changed)', parsed.dedup === false);
	assert('update: still matched', parsed.matchType === 'WHMCS_ID');

	const sync = await db
		.select()
		.from(table.whmcsClientSync)
		.where(
			and(
				eq(table.whmcsClientSync.tenantId, TENANT_ID),
				eq(table.whmcsClientSync.whmcsClientId, 501)
			)
		)
		.get();
	assert('update: sync row lastEvent=updated', sync?.lastEvent === 'updated');
}

// ─────────────────────────────────────────────
// 4. NEW branch — different whmcsClientId, no CUI/email match
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(
		basePayload({
			whmcsClientId: 777,
			taxId: '88888888',
			email: 'brand-new@example.ro',
			companyName: 'Firma Nouă S.R.L'
		})
	);
	const response = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('NEW: 202', response.status === 202);
	const parsed = await response.json();
	assert('NEW: matchType=NEW', parsed.matchType === 'NEW');
	assert('NEW: action=created', parsed.action === 'created');

	const clients = await db
		.select()
		.from(table.client)
		.where(eq(table.client.tenantId, TENANT_ID));
	assert('NEW: 2 client rows total', clients.length === 2);
}

// ─────────────────────────────────────────────
// 5. Malformed JSON
// ─────────────────────────────────────────────
{
	const response = await POST(buildEvent(buildSignedRequest('{not valid json')) as any);
	assert('malformed JSON: 400', response.status === 400);
	const parsed = await response.json();
	assert('malformed JSON: reason', parsed.reason === 'invalid_json');
}

// ─────────────────────────────────────────────
// 6. Malformed payload shape (missing whmcsClientId)
// ─────────────────────────────────────────────
{
	const body = JSON.stringify({ event: 'added', isLegalPerson: true });
	const response = await POST(buildEvent(buildSignedRequest(body)) as any);
	assert('malformed shape: 400', response.status === 400);
	const parsed = await response.json();
	assert('malformed shape: reason', parsed.reason === 'malformed_payload');
}

// ─────────────────────────────────────────────
// 7. Bad signature — wrong secret
// ─────────────────────────────────────────────
{
	const body = JSON.stringify(basePayload({ whmcsClientId: 888 }));
	const response = await POST(
		buildEvent(buildSignedRequest(body, { secret: 'wrong-secret' })) as any
	);
	assert('bad sig: 401', response.status === 401);
	const parsed = await response.json();
	assert('bad sig: reason=signature_mismatch', parsed.reason === 'signature_mismatch');
}

// ─────────────────────────────────────────────
console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
