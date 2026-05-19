/**
 * Backfill user_whatsapp_link from existing phone columns.
 *
 * Sources (in order, idempotent):
 *  1. tenantUser.phone → agency staff
 *  2. client.phone     → the primary clientUser of each client
 *
 * No name-based inference. Phone is normalized to E164 via the shared
 * helper. Rows already present are SKIPPED (idempotent via UNIQUE index).
 *
 * Run:
 *   cd app && bun --bun scripts/backfill-user-whatsapp-links.ts
 *
 * Read-only verification first; pass `--apply` to write.
 */

import { createClient } from '@libsql/client';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const APPLY = process.argv.includes('--apply');

const client = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function normalizePhoneE164(phone: string | null | undefined): string | null {
	if (!phone) return null;
	const cleaned = phone.replace(/[^\d+]/g, '');
	if (!cleaned) return null;
	if (cleaned.startsWith('+')) {
		const digits = cleaned.slice(1);
		if (digits.length >= 7 && digits.length <= 15 && /^\d+$/.test(digits)) return cleaned;
		return null;
	}
	if (cleaned.startsWith('00')) {
		const rest = cleaned.slice(2);
		if (rest.length >= 7 && rest.length <= 15) return `+${rest}`;
		return null;
	}
	if (cleaned.startsWith('0') && cleaned.length === 10) return `+40${cleaned.slice(1)}`;
	if (cleaned.length >= 11 && cleaned.length <= 15) return `+${cleaned}`;
	return null;
}

type Plan = {
	source: 'seed_tenant_user' | 'seed_client';
	tenantId: string;
	userId: string;
	phoneE164: string;
	context: string;
};

async function planTenantUserLinks(): Promise<Plan[]> {
	const rows = (
		await client.execute(
			'SELECT tu.tenant_id, tu.user_id, tu.phone, u.email FROM tenant_user tu JOIN user u ON u.id = tu.user_id WHERE tu.phone IS NOT NULL AND tu.phone != ""'
		)
	).rows as Array<{ tenant_id: string; user_id: string; phone: string; email: string }>;

	const plans: Plan[] = [];
	for (const r of rows) {
		const e164 = normalizePhoneE164(r.phone);
		if (!e164) continue;
		plans.push({
			source: 'seed_tenant_user',
			tenantId: r.tenant_id,
			userId: r.user_id,
			phoneE164: e164,
			context: `agency ${r.email}`
		});
	}
	return plans;
}

async function planPrimaryClientLinks(): Promise<Plan[]> {
	// For each client with phone, find the PRIMARY client_user and link it.
	const rows = (
		await client.execute(
			`SELECT c.tenant_id, c.id AS client_id, c.phone, c.name, cu.user_id, u.email
			 FROM client c
			 JOIN client_user cu ON cu.client_id = c.id AND cu.tenant_id = c.tenant_id AND cu.is_primary = 1
			 JOIN user u ON u.id = cu.user_id
			 WHERE c.phone IS NOT NULL AND c.phone != ""`
		)
	).rows as Array<{
		tenant_id: string;
		client_id: string;
		phone: string;
		name: string;
		user_id: string;
		email: string;
	}>;

	const plans: Plan[] = [];
	for (const r of rows) {
		const e164 = normalizePhoneE164(r.phone);
		if (!e164) continue;
		plans.push({
			source: 'seed_client',
			tenantId: r.tenant_id,
			userId: r.user_id,
			phoneE164: e164,
			context: `client ${r.name} (primary ${r.email})`
		});
	}
	return plans;
}

async function main() {
	console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (read-only)'}\n`);

	const tuPlans = await planTenantUserLinks();
	const clPlans = await planPrimaryClientLinks();

	console.log(`Tenant-user links to insert: ${tuPlans.length}`);
	console.log(`Primary client links to insert: ${clPlans.length}`);

	// De-duplicate plans where the same (tenantId, userId) is covered by both
	// sources — tenant_user wins (it's the explicit staff profile).
	const seen = new Set<string>();
	const merged: Plan[] = [];
	for (const p of [...tuPlans, ...clPlans]) {
		const key = `${p.tenantId}:${p.userId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(p);
	}
	console.log(`\nAfter de-duplication: ${merged.length} unique (tenant, user) pairs\n`);

	// Filter out rows that already exist in user_whatsapp_link.
	const existing = new Set<string>();
	const existingRows = (
		await client.execute('SELECT tenant_id, user_id FROM user_whatsapp_link')
	).rows as Array<{ tenant_id: string; user_id: string }>;
	for (const r of existingRows) {
		existing.add(`${r.tenant_id}:${r.user_id}`);
	}

	const toInsert = merged.filter((p) => !existing.has(`${p.tenantId}:${p.userId}`));
	console.log(`Already in user_whatsapp_link: ${existing.size}`);
	console.log(`To insert: ${toInsert.length}\n`);

	if (toInsert.length === 0) {
		console.log('Nothing to do. ✓');
		process.exit(0);
	}

	// Print a preview (first 10)
	console.log('Preview (first 10):');
	for (const p of toInsert.slice(0, 10)) {
		console.log(`  [${p.source}] ${p.phoneE164} ← ${p.context}`);
	}
	if (toInsert.length > 10) console.log(`  ... and ${toInsert.length - 10} more`);

	if (!APPLY) {
		console.log('\nDry-run only. Re-run with --apply to write.');
		process.exit(0);
	}

	console.log('\nApplying...');
	let inserted = 0;
	let failed = 0;
	for (const p of toInsert) {
		try {
			await client.execute({
				sql: 'INSERT INTO user_whatsapp_link (id, tenant_id, user_id, phone_e164, source) VALUES (?, ?, ?, ?, ?)',
				args: [generateId(), p.tenantId, p.userId, p.phoneE164, p.source]
			});
			inserted++;
		} catch (e: any) {
			failed++;
			if (failed < 5) {
				console.log(`  ✗ ${p.context}: ${e.message?.slice(0, 80) ?? e}`);
			}
		}
	}

	console.log(`\nDone. Inserted: ${inserted}, failed: ${failed}`);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
