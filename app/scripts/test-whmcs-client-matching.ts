/**
 * Unit tests: WHMCS client matching cascade.
 *
 * Covers:
 *   1. Match by whmcs_client_id (stable key after first sync)
 *   2. Match by CUI (most common branch for legal persons)
 *      - Normalizes "RO40015841" == "40015841" == " ro 40015841 "
 *      - Stamps whmcs_client_id on the matched row
 *   3. Match by email (natural persons / tiebreak)
 *      - Case-insensitive
 *      - Stamps whmcs_client_id AND backfills CUI if CRM row lacked it
 *   4. Create when nothing matches (+ warn on "no CUI and no email")
 *   5. Second sync with same payload hits WHMCS_ID branch (idempotent shape)
 *   6. Display-name fallback: companyName → firstName+lastName → email → stub
 *
 * Run:
 *   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-client-matching.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import {
	matchOrCreateClient,
	normalizeCui
} from '../src/lib/server/whmcs/client-matching';
import type { WhmcsClientPayload } from '../src/lib/server/whmcs/types';
import { bootstrapTestSchema } from './_test-schema-bootstrap';

await bootstrapTestSchema();

const TENANT = 't_matching_test';
await db.insert(table.tenant).values({ id: TENANT, name: 'Match Test', slug: 'match-test' });

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

async function cleanupClients() {
	await db.delete(table.client).where(eq(table.client.tenantId, TENANT));
}

function basePayload(overrides: Partial<WhmcsClientPayload> = {}): WhmcsClientPayload {
	return {
		event: 'added',
		whmcsClientId: 100,
		taxId: '40015841',
		companyName: 'ONE TOP SOLUTION S.R.L',
		firstName: 'Augustin',
		lastName: 'Constantin',
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
// 0. normalizeCui helper (pure)
// ─────────────────────────────────────────────

assert('normalizeCui: strips RO prefix', normalizeCui('RO40015841') === '40015841');
assert('normalizeCui: strips ro lowercase', normalizeCui('ro40015841') === '40015841');
assert('normalizeCui: trims whitespace', normalizeCui('  40015841  ') === '40015841');
assert('normalizeCui: drops non-digits', normalizeCui('RO-40015841') === '40015841');
assert('normalizeCui: empty on null', normalizeCui(null) === '');
assert('normalizeCui: empty on undefined', normalizeCui(undefined) === '');
assert('normalizeCui: empty on blank', normalizeCui('   ') === '');

// ─────────────────────────────────────────────
// 1. NEW — nothing matches, clean slate
// ─────────────────────────────────────────────

await cleanupClients();
{
	const result = await matchOrCreateClient(TENANT, basePayload());
	assert('NEW: matchType=NEW', result.matchType === 'NEW');
	assert('NEW: created=true', result.created === true);

	const row = await db.select().from(table.client).where(eq(table.client.id, result.clientId)).get();
	assert('NEW: row inserted', row !== undefined);
	assert('NEW: whmcs_client_id stamped', row?.whmcsClientId === 100);
	assert('NEW: name from companyName', row?.name === 'ONE TOP SOLUTION S.R.L');
	assert('NEW: cui normalized', row?.cui === '40015841');
	assert('NEW: email lowercased', row?.email === 'office@onetopsolution.ro');
	assert('NEW: status active', row?.status === 'active');
	assert('NEW: companyType SRL for legal person', row?.companyType === 'SRL');
	assert('NEW: address preserved', row?.address === 'Tineretului 5');
	assert('NEW: city preserved', row?.city === 'Suceava');
}

// ─────────────────────────────────────────────
// 2. WHMCS_ID — second sync of the same WHMCS client
// ─────────────────────────────────────────────

{
	// Client already in DB from test 1
	const result = await matchOrCreateClient(TENANT, basePayload());
	assert('WHMCS_ID: matchType=WHMCS_ID', result.matchType === 'WHMCS_ID');
	assert('WHMCS_ID: created=false', result.created === false);

	// No duplicate row was created
	const rows = await db.select().from(table.client).where(eq(table.client.tenantId, TENANT));
	assert('WHMCS_ID: still only one client row', rows.length === 1);
}

// ─────────────────────────────────────────────
// 3. CUI — CRM client exists (from Keez import) WITHOUT whmcs_client_id
// ─────────────────────────────────────────────

await cleanupClients();
{
	// Pre-seed: client from another source (Keez) with CUI, no whmcs id
	await db.insert(table.client).values({
		id: 'seed-cui-1',
		tenantId: TENANT,
		name: 'Existing Client SRL',
		businessName: 'Existing Client SRL',
		cui: '40015841',
		email: null,
		avatarSource: 'whatsapp',
		whmcsClientId: null,
		status: 'active'
	} as any);

	// Payload with RO prefix — normalization should still match
	const result = await matchOrCreateClient(TENANT, basePayload({ taxId: 'RO40015841' }));
	assert('CUI: matchType=CUI', result.matchType === 'CUI');
	assert('CUI: clientId is the seeded one', result.clientId === 'seed-cui-1');

	const row = await db.select().from(table.client).where(eq(table.client.id, 'seed-cui-1')).get();
	assert('CUI: whmcs_client_id stamped after match', row?.whmcsClientId === 100);

	// Re-run — should now hit WHMCS_ID branch
	const again = await matchOrCreateClient(TENANT, basePayload({ taxId: 'RO40015841' }));
	assert('CUI→WHMCS_ID: second run hits WHMCS_ID', again.matchType === 'WHMCS_ID');
}

// ─────────────────────────────────────────────
// 4. EMAIL — CRM client exists without CUI but with matching email
// ─────────────────────────────────────────────

await cleanupClients();
{
	await db.insert(table.client).values({
		id: 'seed-email-1',
		tenantId: TENANT,
		name: 'Person by Email',
		email: 'person@example.ro',
		cui: null,
		avatarSource: 'whatsapp',
		whmcsClientId: null,
		status: 'active'
	} as any);

	const result = await matchOrCreateClient(
		TENANT,
		basePayload({
			whmcsClientId: 200,
			taxId: '12345678',
			email: 'PERSON@EXAMPLE.RO' // uppercase — should still match
		})
	);

	assert('EMAIL: matchType=EMAIL', result.matchType === 'EMAIL');
	assert('EMAIL: clientId is seeded row', result.clientId === 'seed-email-1');

	const row = await db.select().from(table.client).where(eq(table.client.id, 'seed-email-1')).get();
	assert('EMAIL: whmcs_client_id stamped', row?.whmcsClientId === 200);
	assert('EMAIL: cui backfilled when CRM row had none', row?.cui === '12345678');
}

// ─────────────────────────────────────────────
// 5. EMAIL — CRM row with existing CUI, DO NOT overwrite it
// ─────────────────────────────────────────────

await cleanupClients();
{
	await db.insert(table.client).values({
		id: 'seed-email-cui',
		tenantId: TENANT,
		name: 'Has CUI',
		email: 'has-cui@example.ro',
		cui: '99999999', // existing — must be preserved
		avatarSource: 'whatsapp',
		whmcsClientId: null,
		status: 'active'
	} as any);

	await matchOrCreateClient(
		TENANT,
		basePayload({
			whmcsClientId: 300,
			taxId: '40015841', // different from existing
			email: 'has-cui@example.ro'
		})
	);

	const row = await db.select().from(table.client).where(eq(table.client.id, 'seed-email-cui')).get();
	assert('EMAIL: existing CUI preserved, not overwritten', row?.cui === '99999999');
	assert('EMAIL: whmcs_client_id still stamped', row?.whmcsClientId === 300);
}

// ─────────────────────────────────────────────
// 6. NEW: no CUI, no email → still creates (with warn)
// ─────────────────────────────────────────────

await cleanupClients();
{
	const result = await matchOrCreateClient(
		TENANT,
		basePayload({
			whmcsClientId: 999,
			taxId: null,
			email: null,
			companyName: null,
			firstName: 'John',
			lastName: 'Doe'
		})
	);

	assert('NEW-minimal: matchType=NEW', result.matchType === 'NEW');
	const row = await db.select().from(table.client).where(eq(table.client.id, result.clientId)).get();
	assert('NEW-minimal: display name from first+last', row?.name === 'John Doe');
	assert('NEW-minimal: cui null', row?.cui === null);
	assert('NEW-minimal: email null', row?.email === null);
}

// ─────────────────────────────────────────────
// 7. NEW: display name fallback chain
// ─────────────────────────────────────────────

await cleanupClients();
{
	// No company, no names, no email → fallback to "WHMCS #id"
	const result = await matchOrCreateClient(
		TENANT,
		basePayload({
			whmcsClientId: 777,
			taxId: null,
			email: null,
			companyName: null,
			firstName: null,
			lastName: null
		})
	);
	const row = await db.select().from(table.client).where(eq(table.client.id, result.clientId)).get();
	assert('NEW-fallback: name uses WHMCS #id stub', row?.name === 'WHMCS #777');
}

// ─────────────────────────────────────────────
// 8. Tenant isolation — identical whmcs_client_id in different tenants must NOT collide
// ─────────────────────────────────────────────

await cleanupClients();
const OTHER_TENANT = 't_matching_other';
await db.insert(table.tenant).values({ id: OTHER_TENANT, name: 'Other', slug: 'other-match' });
await db.insert(table.client).values({
	id: 'other-seed',
	tenantId: OTHER_TENANT,
	name: 'Other tenant CUI holder',
	cui: '40015841',
	avatarSource: 'whatsapp',
	whmcsClientId: 100,
	status: 'active'
} as any);

{
	// Our tenant has no client with cui=40015841 → should create NEW
	const result = await matchOrCreateClient(TENANT, basePayload());
	assert('tenant isolation: NEW (does not match other tenant row)', result.matchType === 'NEW');
	assert('tenant isolation: new row in our tenant', result.clientId !== 'other-seed');

	const otherRow = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, 'other-seed'))
		.get();
	assert('tenant isolation: other tenant row untouched', otherRow?.whmcsClientId === 100);
}

// ─────────────────────────────────────────────

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
