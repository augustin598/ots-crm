import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock, type DaAuditTrigger } from '$lib/server/plugins/directadmin/audit';
import { encrypt } from '$lib/server/plugins/smartbill/crypto';

/**
 * Shared "create one DA account" pipeline. Same logic the user-facing
 * `/hosting/accounts/new` form has been hitting via `createHostingAccount` — pulled
 * out so the Comenzi hosting drawer can call the exact same path with admin-typed
 * credentials.
 *
 * Caller MUST have already authorized the actor (`assertCan(..., 'admin.hosting.manage')`).
 * This helper does NOT read request context — `tenantId` is the trust boundary.
 *
 * Idempotency is the caller's responsibility (DA will reject duplicate usernames
 * server-side — we rely on that signal rather than pre-checking).
 */
export interface CreateHostingAccountPayload {
	clientId: string;
	daServerId: string;
	daPackageId?: string | undefined;
	hostingProductId?: string | undefined;
	daUsername: string;
	domain: string;
	password: string;
	recurringAmount?: number | undefined; // cents per cycle
	currency?: string | undefined;
	billingCycle?: string | undefined;
	nextDueDate?: string | undefined;
	notes?: string | undefined;
	stripeSubscriptionId?: string | null | undefined;
	/** What action attribution to write to da_audit_log. Defaults to 'manual'. */
	auditTrigger?: DaAuditTrigger;
}

export interface CreateHostingAccountResult {
	id: string;
	daUsername: string;
	domain: string;
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export async function createHostingAccountInternal(
	tenantId: string,
	payload: CreateHostingAccountPayload
): Promise<CreateHostingAccountResult> {
	const [server] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.id, payload.daServerId), eq(table.daServer.tenantId, tenantId)))
		.limit(1);
	if (!server) throw new Error('Server DA inexistent sau aparține altui tenant.');

	let packageName = 'default';
	if (payload.daPackageId) {
		const [pkg] = await db
			.select({ daName: table.daPackage.daName })
			.from(table.daPackage)
			.where(eq(table.daPackage.id, payload.daPackageId))
			.limit(1);
		if (pkg) packageName = pkg.daName;
	}

	const [clientData] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, payload.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!clientData) throw new Error('Clientul nu există pentru acest tenant.');

	const id = generateId();
	const daClient = createDAClient(tenantId, server);

	await withAccountLock(`${tenantId}:${payload.daUsername}`, async () => {
		await runWithAudit(
			{
				tenantId,
				hostingAccountId: id,
				daServerId: payload.daServerId,
				action: 'create',
				trigger: payload.auditTrigger ?? 'manual'
			},
			() =>
				daClient.createUserAccount({
					username: payload.daUsername,
					password: payload.password,
					domain: payload.domain,
					email: clientData.email ?? '',
					package: packageName
				})
		);

		const credentialsEncrypted = encrypt(
			tenantId,
			JSON.stringify({ username: payload.daUsername, password: payload.password })
		);

		await db.insert(table.hostingAccount).values({
			id,
			tenantId,
			clientId: payload.clientId,
			daServerId: payload.daServerId,
			daPackageId: payload.daPackageId,
			hostingProductId: payload.hostingProductId,
			daUsername: payload.daUsername,
			domain: payload.domain,
			status: 'active',
			daCredentialsEncrypted: credentialsEncrypted,
			recurringAmount: payload.recurringAmount ?? 0,
			currency: payload.currency ?? 'RON',
			billingCycle: payload.billingCycle ?? 'monthly',
			nextDueDate: payload.nextDueDate,
			notes: payload.notes,
			stripeSubscriptionId: payload.stripeSubscriptionId ?? null
		});
	});

	return { id, daUsername: payload.daUsername, domain: payload.domain };
}
