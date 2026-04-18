// Diagnostic snapshot for TikTok Ads auth state.
// Usage: cd app && bun scripts/verify-tiktok-tokens.ts <tenant-slug-or-id>
// Reports per integration: token expiry, refresh failures, account mapping.
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq, or } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';

if (!process.env.SQLITE_URI || !process.env.SQLITE_AUTH_TOKEN) {
	console.error('SQLITE_URI / SQLITE_AUTH_TOKEN env vars are required');
	process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
	console.error('Usage: bun scripts/verify-tiktok-tokens.ts <tenant-slug-or-id>');
	process.exit(1);
}

const client = createClient({
	url: process.env.SQLITE_URI,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
const db = drizzle(client, { schema });

const [tenant] = await db
	.select()
	.from(schema.tenant)
	.where(or(eq(schema.tenant.id, arg), eq(schema.tenant.slug, arg)))
	.limit(1);
if (!tenant) {
	console.error('Tenant not found:', arg);
	process.exit(1);
}

const integrations = await db
	.select()
	.from(schema.tiktokAdsIntegration)
	.where(eq(schema.tiktokAdsIntegration.tenantId, tenant.id));

console.log(`Tenant: ${tenant.name} (${tenant.slug})`);
console.log(`TikTok integrations: ${integrations.length}\n`);

const now = Date.now();
for (const int of integrations) {
	const accessLeftH = int.tokenExpiresAt ? Math.round((int.tokenExpiresAt.getTime() - now) / 3_600_000) : null;
	const refreshLeftD = int.refreshTokenExpiresAt ? Math.round((int.refreshTokenExpiresAt.getTime() - now) / 86_400_000) : null;

	console.log(`— Integration ${int.id}`);
	console.log(`    orgId=${int.orgId || '(empty)'}  active=${int.isActive}  syncEnabled=${int.syncEnabled}`);
	console.log(`    access_token: ${int.accessToken ? 'present' : 'EMPTY'}  expiresAt=${int.tokenExpiresAt?.toISOString() ?? 'null'}  (≈${accessLeftH ?? '?'}h left)`);
	console.log(`    refresh_token: ${int.refreshToken ? 'present' : 'EMPTY'}  expiresAt=${int.refreshTokenExpiresAt?.toISOString() ?? 'null'}  (≈${refreshLeftD ?? '?'}d left)`);
	console.log(`    lastRefreshAttemptAt=${int.lastRefreshAttemptAt?.toISOString() ?? 'null'}  consecFailures=${int.consecutiveRefreshFailures ?? 0}`);
	console.log(`    lastRefreshError=${int.lastRefreshError ?? 'null'}`);

	const accounts = await db
		.select()
		.from(schema.tiktokAdsAccount)
		.where(eq(schema.tiktokAdsAccount.integrationId, int.id));
	const activeCount = accounts.filter((a) => a.isActive).length;
	const mappedCount = accounts.filter((a) => a.clientId).length;
	console.log(`    accounts: ${accounts.length} (${activeCount} active, ${mappedCount} mapped)`);
	for (const a of accounts) {
		console.log(`      • ${a.tiktokAdvertiserId}  "${a.accountName}"  active=${a.isActive}  clientId=${a.clientId ?? 'null'}`);
	}
	console.log('');
}

// Summary — highlights suspicious patterns
const activeIntegrations = integrations.filter((i) => i.isActive);
const duplicatedOrgIds = new Set<string>();
const seen = new Set<string>();
for (const i of integrations) {
	if (!i.orgId) continue;
	if (seen.has(i.orgId)) duplicatedOrgIds.add(i.orgId);
	seen.add(i.orgId);
}

const advertiserToIntegrations = new Map<string, string[]>();
for (const i of integrations) {
	const accs = await db
		.select({ advertiserId: schema.tiktokAdsAccount.tiktokAdvertiserId })
		.from(schema.tiktokAdsAccount)
		.where(eq(schema.tiktokAdsAccount.integrationId, i.id));
	for (const a of accs) {
		const list = advertiserToIntegrations.get(a.advertiserId) ?? [];
		list.push(i.id);
		advertiserToIntegrations.set(a.advertiserId, list);
	}
}
const duplicatedAdvertisers = Array.from(advertiserToIntegrations.entries()).filter(([, ids]) => ids.length > 1);

console.log('── Summary ──────────────────────────────────────────────');
console.log(`Active integrations: ${activeIntegrations.length}/${integrations.length}`);
if (duplicatedOrgIds.size > 0) console.log(`⚠ Duplicated orgIds: ${Array.from(duplicatedOrgIds).join(', ')}`);
if (duplicatedAdvertisers.length > 0) {
	console.log(`⚠ Advertiser IDs across multiple integrations (confirms dropdown bug):`);
	for (const [adv, ids] of duplicatedAdvertisers) {
		console.log(`    ${adv} → ${ids.join(', ')}`);
	}
}
const highFailures = integrations.filter((i) => (i.consecutiveRefreshFailures ?? 0) >= 3);
if (highFailures.length > 0) {
	console.log(`⚠ Integrations near auto-deactivation (>=3 consecutive failures):`);
	for (const i of highFailures) {
		console.log(`    ${i.id}  failures=${i.consecutiveRefreshFailures}  lastError=${i.lastRefreshError}`);
	}
}
const shortLifeTokens = integrations.filter((i) => {
	if (!i.tokenExpiresAt) return false;
	const diffMs = i.tokenExpiresAt.getTime() - (i.updatedAt?.getTime() ?? i.createdAt?.getTime() ?? now);
	return diffMs > 0 && diffMs < 48 * 3_600_000; // less than 48h lifetime = mapping bug suspect
});
if (shortLifeTokens.length > 0) {
	console.log(`⚠ Integrations with suspiciously short access-token lifetime (<48h → field mapping bug suspect):`);
	for (const i of shortLifeTokens) {
		console.log(`    ${i.id}  expiresAt=${i.tokenExpiresAt?.toISOString()}  updatedAt=${i.updatedAt?.toISOString()}`);
	}
}
console.log('─────────────────────────────────────────────────────────');

process.exit(0);
