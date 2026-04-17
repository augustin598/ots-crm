import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import * as table from './db/schema';
import * as auth from './auth';
import { eq, and, sql } from 'drizzle-orm';
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
) {
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

	// Atomic claim: UPDATE ... WHERE used=false inside a transaction prevents
	// two concurrent requests from both succeeding with the same token (TOCTOU fix).
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

		// Atomically mark as used within the same transaction
		await tx
			.update(table.magicLinkToken)
			.set({ used: true, usedAt: new Date() })
			.where(
				and(
					eq(table.magicLinkToken.id, record.id),
					eq(table.magicLinkToken.used, false)
				)
			);

		return record;
	});

	if (!tokenRecord) {
		throw new Error('Invalid or expired token');
	}

	// Check if token is expired (already marked used above, so no second use possible)
	if (Date.now() >= tokenRecord.expiresAt.getTime()) {
		throw new Error('Token has expired. Please request a new magic link.');
	}

	// Get client
	if (!tokenRecord.clientId) {
		throw new Error('Invalid token - no client associated');
	}

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, tokenRecord.clientId))
		.limit(1);

	if (!client) {
		throw new Error('Client not found');
	}

	// Determine if the login email is the primary email
	const isPrimary = tokenRecord.email.toLowerCase() === client.email?.toLowerCase();

	// If not primary, verify it exists as a secondary email for this client
	if (!isPrimary) {
		const [secondary] = await db
			.select()
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, client.id),
					eq(table.clientSecondaryEmail.tenantId, tenant.id),
					eq(sql`lower(${table.clientSecondaryEmail.email})`, tokenRecord.email.toLowerCase())
				)
			)
			.limit(1);
		if (!secondary) {
			throw new Error('Email address no longer authorized for this client.');
		}
	}

	// Delegate to shared logic
	const result = await findOrCreateClientUserSession(
		tenant,
		client,
		tokenRecord.email,
		isPrimary,
		event
	);

	return { success: true, userId: result.userId };
}

/**
 * Match an email against a tenant's clients (primary + secondary),
 * then find/create user + clientUser and optionally create a session.
 * Used by both magic link verification and Google OAuth login.
 */
export async function findOrCreateClientSession(
	tenantSlug: string,
	email: string,
	event?: RequestEvent
): Promise<
	| { success: true; userId: string; clientId: string; isPrimary: boolean }
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

	// Try to match primary email
	let [client] = await db
		.select()
		.from(table.client)
		.where(
			and(
				eq(table.client.tenantId, tenant.id),
				eq(sql`lower(${table.client.email})`, normalizedEmail)
			)
		)
		.limit(1);

	let isPrimary = !!client;

	// Try secondary email if no primary match
	if (!client) {
		const [secondaryMatch] = await db
			.select({ client: table.client })
			.from(table.clientSecondaryEmail)
			.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
			.where(
				and(
					eq(table.clientSecondaryEmail.tenantId, tenant.id),
					eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
				)
			)
			.limit(1);

		if (secondaryMatch) {
			client = secondaryMatch.client;
			isPrimary = false;
		}
	}

	if (!client) {
		return { success: false, reason: 'no-match' };
	}

	const result = await findOrCreateClientUserSession(tenant, client, email, isPrimary, event);
	return { success: true, userId: result.userId, clientId: client.id, isPrimary };
}

/**
 * Internal: find/create user + clientUser rows and optionally create session
 */
async function findOrCreateClientUserSession(
	tenant: { id: string },
	client: { id: string; name: string },
	email: string,
	isPrimary: boolean,
	event?: RequestEvent
): Promise<{ userId: string }> {
	// Normalize email to lowercase to prevent duplicate user records
	const normalizedEmail = email.toLowerCase();

	// Find or create user (race-safe: INSERT...ON CONFLICT handles concurrent magic link clicks)
	let user = await db
		.select()
		.from(table.user)
		.where(eq(table.user.email, normalizedEmail))
		.limit(1)
		.then((users) => users[0] || null);

	if (!user) {
		const emailParts = normalizedEmail.split('@');

		const contactName = await resolveContactName(client.id, normalizedEmail, isPrimary);
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

		// Use ON CONFLICT to handle concurrent requests (e.g., multi-device magic link clicks)
		await db.insert(table.user).values({
			id: userId,
			email: normalizedEmail,
			firstName,
			lastName,
			passwordHash
		}).onConflictDoNothing({ target: table.user.email });

		// Always re-fetch by email (our insert may have been a no-op due to conflict)
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

	// Sync user name from contact label if user still has the company name
	if (user) {
		const contactName = await resolveContactName(client.id, normalizedEmail, isPrimary);

		if (contactName) {
			const nameParts = contactName.split(' ');
			const newFirst = nameParts[0] || '';
			const newLast = nameParts.slice(1).join(' ') || '';
			const currentName = `${user.firstName} ${user.lastName}`.trim();
			const newContactName = `${newFirst} ${newLast}`.trim();
			// Only update if name is empty, matches company name, or already matches a previous contact label
			// This prevents overwriting names that were manually edited by admin
			const emailPrefix = normalizedEmail.split('@')[0];
			const isDefaultOrCompanyName = !user.firstName || currentName === client.name || currentName === emailPrefix;
			const isAlreadyCorrect = currentName === newContactName;
			if (isDefaultOrCompanyName && !isAlreadyCorrect) {
				await db
					.update(table.user)
					.set({ firstName: newFirst, lastName: newLast })
					.where(eq(table.user.id, user.id));
			}
		}
	}

	// Check if clientUser relationship already exists
	const [existingClientUser] = await db
		.select()
		.from(table.clientUser)
		.where(
			and(
				eq(table.clientUser.userId, user.id),
				eq(table.clientUser.clientId, client.id),
				eq(table.clientUser.tenantId, tenant.id)
			)
		)
		.limit(1);

	if (existingClientUser) {
		if (existingClientUser.isPrimary !== isPrimary) {
			await db
				.update(table.clientUser)
				.set({ isPrimary, updatedAt: new Date() })
				.where(eq(table.clientUser.id, existingClientUser.id));
		}
	} else {
		const clientUserId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.clientUser).values({
			id: clientUserId,
			userId: user.id,
			clientId: client.id,
			tenantId: tenant.id,
			isPrimary
		});
	}

	// Create session if event is provided
	if (event) {
		// Invalidate all existing sessions for this user (prevents session fixation)
		await auth.invalidateUserSessions(user.id);
		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, user.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
	}

	return { userId: user.id };
}
