/**
 * One-shot helper: delete a leftover Keez Draft by externalId.
 * Usage: WHMCS_CLEANUP_TENANT=ots WHMCS_CLEANUP_EXTID=<id> bun --env-file=.env --preload ./scripts/_live-preload.ts ./scripts/_cleanup-leftover-draft.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { createKeezClientForTenant } from '../src/lib/server/plugins/keez/factory';

const slug = process.env.WHMCS_CLEANUP_TENANT;
const extId = process.env.WHMCS_CLEANUP_EXTID;
if (!slug || !extId) {
	console.error('Set WHMCS_CLEANUP_TENANT and WHMCS_CLEANUP_EXTID');
	process.exit(2);
}
const tenant = await db.select().from(table.tenant).where(eq(table.tenant.slug, slug!)).get();
if (!tenant) {
	console.error('tenant not found');
	process.exit(2);
}
const integration = await db
	.select()
	.from(table.keezIntegration)
	.where(eq(table.keezIntegration.tenantId, tenant.id))
	.get();
if (!integration) {
	console.error('keez integration not found');
	process.exit(2);
}
const keezClient = await createKeezClientForTenant(tenant.id, {
	clientEid: integration.clientEid,
	applicationId: integration.applicationId,
	secret: integration.secret,
	accessToken: integration.accessToken,
	tokenExpiresAt: integration.tokenExpiresAt
});
await keezClient.deleteInvoice(extId!);
console.log(`Deleted ${extId}`);
process.exit(0);
