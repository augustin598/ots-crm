import { db } from '$lib/server/db';
import { eq, and, inArray } from 'drizzle-orm';
import {
	client as clientTable,
	hostingInquiry,
	tenantUser,
	user as userTable,
	tenant as tenantTable,
} from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';

export class OrphanAccountError extends Error {
	constructor(public readonly accountId: string) {
		super(`hosting account ${accountId} has no client and no inquiry`);
		this.name = 'OrphanAccountError';
	}
}

export class NoAdminRecipientError extends Error {
	constructor(public readonly tenantId: string) {
		super(`no admin recipient resolvable for tenant ${tenantId}`);
		this.name = 'NoAdminRecipientError';
	}
}

export interface ResolvedCustomer {
	email: string;
	name: string;
	source: 'client' | 'inquiry';
}

/**
 * Returns the calendar date in Europe/Bucharest as YYYY-MM-DD.
 * Used as a 24h dedupe bucket where midnight rollover into a new bucket is
 * acceptable.
 */
export function dayBucketEET(now: Date = new Date()): string {
	const formatter = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	return formatter.format(now); // sv-SE locale gives YYYY-MM-DD format
}

/**
 * Resolves the customer recipient (email + display name) for a hosting account.
 *
 * 3-tier fallback:
 *   1. client.email (when account.clientId is set) — prefers businessName over name
 *   2. hostingInquiry.contactEmail (linked by hostingAccountId)
 *   3. throws OrphanAccountError
 *
 * All queries are tenant-scoped.
 */
export async function resolveCustomerEmail(account: {
	id: string;
	tenantId: string;
	clientId: string | null;
}): Promise<ResolvedCustomer> {
	// 1. Prefer client.email when clientId is present
	if (account.clientId) {
		const [c] = await db
			.select({
				email: clientTable.email,
				name: clientTable.name,
				businessName: clientTable.businessName,
			})
			.from(clientTable)
			.where(
				and(eq(clientTable.id, account.clientId), eq(clientTable.tenantId, account.tenantId)),
			)
			.limit(1);
		if (c?.email) {
			// Prefer businessName (official) when available, fall back to display name
			const name = c.businessName ?? c.name ?? c.email;
			return { email: c.email, name, source: 'client' };
		}
	}

	// 2. Fallback: hostingInquiry.contactEmail
	const [inq] = await db
		.select({
			email: hostingInquiry.contactEmail,
			name: hostingInquiry.contactName,
		})
		.from(hostingInquiry)
		.where(
			and(
				eq(hostingInquiry.hostingAccountId, account.id),
				eq(hostingInquiry.tenantId, account.tenantId),
			),
		)
		.limit(1);
	if (inq?.email) {
		return { email: inq.email, name: inq.name ?? inq.email, source: 'inquiry' };
	}

	// 3. No email available
	throw new OrphanAccountError(account.id);
}

/**
 * Resolves admin recipients for a tenant.
 *
 * 3-tier fallback:
 *   1. tenantUser with role=owner or admin AND status=active
 *   2. tenant.adminContactEmail (single-string column)
 *   3. OPS_FALLBACK_EMAIL env var
 *   4. throws NoAdminRecipientError
 */
export async function resolveAdminRecipients(tenantId: string): Promise<string[]> {
	// Level 1: tenantUser with role=owner or admin (and active status)
	const users = await db
		.select({ email: userTable.email })
		.from(tenantUser)
		.innerJoin(userTable, eq(tenantUser.userId, userTable.id))
		.where(
			and(
				eq(tenantUser.tenantId, tenantId),
				inArray(tenantUser.role, ['owner', 'admin']),
				eq(tenantUser.status, 'active'),
			),
		);
	const emails = users.map((u) => u.email).filter((e): e is string => !!e);
	if (emails.length > 0) return emails;

	// Level 2: tenant.adminContactEmail (column added in migration 0379)
	const [t] = await db
		.select({ email: tenantTable.adminContactEmail })
		.from(tenantTable)
		.where(eq(tenantTable.id, tenantId))
		.limit(1);
	if (t?.email) return [t.email];

	// Level 3: OPS_FALLBACK_EMAIL env var
	if (env.OPS_FALLBACK_EMAIL) return [env.OPS_FALLBACK_EMAIL];

	// All fallbacks exhausted
	throw new NoAdminRecipientError(tenantId);
}
