import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import * as table from './db/schema';
import * as auth from './auth';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase, encodeBase32LowerCase } from '@oslojs/encoding';
import { hash } from '@node-rs/argon2';

function generateUserId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

/**
 * Resolve contact name from secondary email label or client legalRepresentative
 */
async function resolveContactName(clientId: string, normalizedEmail: string, isPrimary: boolean): Promise<string> {
	if (!isPrimary) {
		const [secondaryEmail] = await db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.email, normalizedEmail)
				)
			)
			.limit(1);
		if (secondaryEmail?.label) {
			return secondaryEmail.label.trim();
		}
	} else {
		const [fullClient] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, clientId))
			.limit(1);
		if (fullClient?.legalRepresentative) {
			return fullClient.legalRepresentative.trim();
		}
	}
	return '';
}

/**
 * Server-side helper function to verify magic link token
 * This can be called from both server load functions and commands
 */
export async function verifyMagicLinkToken(
	tenantSlug: string,
	token: string,
	event?: RequestEvent
): Promise<{ success: true; userId: string; clientCount: number; activeClientId: string }> {
	// Find tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw new Error('Tenant not found');
	}

	// Hash the provided token
	const hashedToken = hashToken(token);

	// Atomic claim: SELECT + UPDATE in transaction with rowsAffected check.
	// Prevents two concurrent requests from both consuming the same token (TOCTOU fix).
	const tokenRecord = await db.transaction(async (tx) => {
		const [record] = await tx
			.select()
			.from(table.magicLinkToken)
			.where(
				and(
					eq(table.magicLinkToken.token, hashedToken),
					eq(table.magicLinkToken.tenantId, tenant.id),
					eq(table.magicLinkToken.used, false)
				)
			)
			.limit(1);

		if (!record) return null;

		// Check expiry BEFORE consuming the token (don't burn expired tokens)
		if (Date.now() >= record.expiresAt.getTime()) {
			return null;
		}

		// Atomically mark as used; check rowsAffected to detect concurrent claim
		const result = await tx
			.update(table.magicLinkToken)
			.set({ used: true, usedAt: new Date() })
			.where(
				and(
					eq(table.magicLinkToken.id, record.id),
					eq(table.magicLinkToken.used, false)
				)
			);

		// If another request already claimed it, rowsAffected will be 0
		if ((result as { rowsAffected?: number })?.rowsAffected === 0) return null;

		return record;
	});

	if (!tokenRecord) {
		throw new Error('Invalid or expired token. Please request a new magic link.');
	}

	// Resolve the list of client IDs the token authorizes, in priority order:
	// 1. matchedClientIds (snapshot at request time — multi-company)
	// 2. clientId (legacy single-client tokens)
	let candidateIds: string[] = [];
	if (tokenRecord.matchedClientIds) {
		try {
			const parsed = JSON.parse(tokenRecord.matchedClientIds);
			if (Array.isArray(parsed)) {
				candidateIds = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
			}
		} catch {
			// Malformed JSON — fall through to legacy clientId
		}
	}
	if (candidateIds.length === 0 && tokenRecord.clientId) {
		candidateIds = [tokenRecord.clientId];
	}
	if (candidateIds.length === 0) {
		throw new Error('Invalid token - no clients associated');
	}

	// Re-validate against current DB state: filter to clients that still exist
	// in this tenant and are not soft-deleted/inactive. Skips any that were
	// removed between request and verify.
	const validClients = await db
		.select()
		.from(table.client)
		.where(
			and(
				inArray(table.client.id, candidateIds),
				eq(table.client.tenantId, tenant.id)
			)
		);

	if (validClients.length === 0) {
		throw new Error('No active clients matched for this token. Please request a new magic link.');
	}

	// For each client, recompute whether the login email is primary or secondary.
	// Skip clients where the email is no longer authorized (admin removed it).
	const normalizedEmail = tokenRecord.email.toLowerCase();
	const authorized: { client: typeof validClients[number]; isPrimary: boolean }[] = [];

	for (const cli of validClients) {
		const isPrimary = cli.email?.toLowerCase() === normalizedEmail;
		if (isPrimary) {
			authorized.push({ client: cli, isPrimary: true });
			continue;
		}
		const [secondary] = await db
			.select({ id: table.clientSecondaryEmail.id })
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, cli.id),
					eq(table.clientSecondaryEmail.tenantId, tenant.id),
					eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
				)
			)
			.limit(1);
		if (secondary) {
			authorized.push({ client: cli, isPrimary: false });
		}
	}

	if (authorized.length === 0) {
		throw new Error('Email address no longer authorized for any matched client.');
	}

	// Delegate to shared logic — creates user + N clientUser rows + session
	const result = await findOrCreateClientUserSession(
		tenant,
		authorized,
		tokenRecord.email,
		event
	);

	return {
		success: true,
		userId: result.userId,
		clientCount: result.clientCount,
		activeClientId: result.activeClientId
	};
}

/**
 * Match an email against a tenant's clients (primary + secondary),
 * then find/create user + clientUser and optionally create a session.
 * Used by both magic link verification and Google OAuth login.
 *
 * Returns clientCount so callers can decide whether to redirect to the
 * /select-company page (when N>1) vs the dashboard (when N=1).
 */
export async function findOrCreateClientSession(
	tenantSlug: string,
	email: string,
	event?: RequestEvent
): Promise<
	| { success: true; userId: string; clientCount: number; activeClientId: string }
	| { success: false; reason: 'no-match' | 'tenant-not-found' }
> {
	// Find tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		return { success: false, reason: 'tenant-not-found' };
	}

	const normalizedEmail = email.toLowerCase();

	// Find ALL clients matching this email (primary + secondary)
	const primaryMatches = await db
		.select()
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenant.id),
				eq(sql`lower(${table.client.email})`, normalizedEmail)
			)
		);

	const secondaryMatches = await db
		.select({ client: table.client })
		.from(table.clientSecondaryEmail)
		.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenant.id),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
			)
		);

	const seen = new Set<string>();
	const authorized: { client: typeof primaryMatches[number]; isPrimary: boolean }[] = [];
	for (const cli of primaryMatches) {
		if (seen.has(cli.id)) continue;
		seen.add(cli.id);
		authorized.push({ client: cli, isPrimary: true });
	}
	for (const sm of secondaryMatches) {
		if (seen.has(sm.client.id)) continue;
		seen.add(sm.client.id);
		authorized.push({ client: sm.client, isPrimary: false });
	}

	if (authorized.length === 0) {
		return { success: false, reason: 'no-match' };
	}

	const result = await findOrCreateClientUserSession(tenant, authorized, email, event);
	return {
		success: true,
		userId: result.userId,
		clientCount: result.clientCount,
		activeClientId: result.activeClientId
	};
}

/**
 * Internal: find/create user + N clientUser rows (one per authorized client)
 * and optionally create a session.
 *
 * `authorized` lists each client the email is authorized for, with whether
 * the email is the primary one for that specific client. Each client gets
 * its own clientUser row (idempotent — uses unique index on user/client/tenant).
 *
 * Returns the count of clients linked + which one is "active" right after
 * login. Active selection rule: prefer the most recently selected
 * (lastSelectedAt), falling back to the first authorized client. Caller
 * decides whether to redirect to /select-company (when count > 1) or
 * straight to /dashboard.
 */
async function findOrCreateClientUserSession(
	tenant: { id: string },
	authorized: { client: { id: string; name: string; email: string | null }; isPrimary: boolean }[],
	email: string,
	event?: RequestEvent
): Promise<{ userId: string; clientCount: number; activeClientId: string }> {
	if (authorized.length === 0) {
		throw new Error('No authorized clients provided to session helper');
	}

	const normalizedEmail = email.toLowerCase();
	const firstClient = authorized[0].client;
	const firstIsPrimary = authorized[0].isPrimary;

	// Find or create user (race-safe: INSERT...ON CONFLICT handles concurrent magic link clicks).
	// User's display name is resolved from the FIRST authorized client's contact info.
	let user = await db
		.select()
		.from(table.user)
		.where(eq(table.user.email, normalizedEmail))
		.limit(1)
		.then((users) => users[0] || null);

	if (!user) {
		const emailParts = normalizedEmail.split('@');

		const contactName = await resolveContactName(firstClient.id, normalizedEmail, firstIsPrimary);
		const nameParts = contactName ? contactName.split(' ') : [];
		const firstName = nameParts[0] || emailParts[0];
		const lastName = nameParts.slice(1).join(' ') || '';

		const userId = generateUserId();
		const randomPassword = crypto.getRandomValues(new Uint8Array(32));
		const randomPasswordStr = Array.from(randomPassword, (b) => b.toString(16).padStart(2, '0')).join('');
		const passwordHash = await hash(randomPasswordStr, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		await db.insert(table.user).values({
			id: userId,
			email: normalizedEmail,
			firstName,
			lastName,
			passwordHash
		}).onConflictDoNothing({ target: table.user.email });

		user = await db
			.select()
			.from(table.user)
			.where(eq(table.user.email, normalizedEmail))
			.limit(1)
			.then((users) => users[0] || null);

		if (!user) {
			throw new Error('Failed to create user');
		}
	}

	// Sync user display name from contact label (only if not manually edited)
	{
		const contactName = await resolveContactName(firstClient.id, normalizedEmail, firstIsPrimary);
		if (contactName) {
			const nameParts = contactName.split(' ');
			const newFirst = nameParts[0] || '';
			const newLast = nameParts.slice(1).join(' ') || '';
			const currentName = `${user.firstName} ${user.lastName}`.trim();
			const newContactName = `${newFirst} ${newLast}`.trim();
			const emailPrefix = normalizedEmail.split('@')[0];
			const isDefaultOrCompanyName =
				!user.firstName || currentName === firstClient.name || currentName === emailPrefix;
			const isAlreadyCorrect = currentName === newContactName;
			if (isDefaultOrCompanyName && !isAlreadyCorrect) {
				await db
					.update(table.user)
					.set({ firstName: newFirst, lastName: newLast })
					.where(eq(table.user.id, user.id));
			}
		}
	}

	// Upsert one clientUser per authorized client (idempotent: unique index
	// on user_id + client_id + tenant_id). This is what enables multi-company
	// access for a single email.
	for (const { client: cli, isPrimary } of authorized) {
		const [existing] = await db
			.select()
			.from(table.clientUser)
			.where(
				and(
					eq(table.clientUser.userId, user.id),
					eq(table.clientUser.clientId, cli.id),
					eq(table.clientUser.tenantId, tenant.id)
				)
			)
			.limit(1);

		if (existing) {
			if (existing.isPrimary !== isPrimary) {
				await db
					.update(table.clientUser)
					.set({ isPrimary, updatedAt: new Date() })
					.where(eq(table.clientUser.id, existing.id));
			}
		} else {
			const clientUserId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.clientUser).values({
				id: clientUserId,
				userId: user.id,
				clientId: cli.id,
				tenantId: tenant.id,
				isPrimary
			});
		}
	}

	// Determine which client is "active" right after login. Prefer the most
	// recently selected one (lastSelectedAt) so returning users land on the
	// company they were last using; otherwise fall back to the first authorized.
	const [mostRecent] = await db
		.select({ clientId: table.clientUser.clientId })
		.from(table.clientUser)
		.where(
			and(
				eq(table.clientUser.userId, user.id),
				eq(table.clientUser.tenantId, tenant.id),
				inArray(
					table.clientUser.clientId,
					authorized.map((a) => a.client.id)
				)
			)
		)
		.orderBy(sql`${table.clientUser.lastSelectedAt} DESC NULLS LAST`)
		.limit(1);

	const activeClientId = mostRecent?.clientId ?? firstClient.id;

	// Total clientUser count for this user/tenant determines if /select-company
	// page should be shown. We re-query rather than use authorized.length so
	// existing links (from previous logins on different emails) are counted too.
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.clientUser)
		.where(
			and(
				eq(table.clientUser.userId, user.id),
				eq(table.clientUser.tenantId, tenant.id)
			)
		);

	// Create session if event is provided
	if (event) {
		// Invalidate all existing sessions for this user (prevents session fixation)
		await auth.invalidateUserSessions(user.id);
		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, user.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
	}

	return { userId: user.id, clientCount: Number(count), activeClientId };
}
