import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import * as table from './db/schema';
import * as auth from './auth';
import { eq, and } from 'drizzle-orm';
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

	// Find token in database
	const [tokenRecord] = await db
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

	if (!tokenRecord) {
		throw new Error('Invalid or expired token');
	}

	// Check if token is expired
	if (Date.now() >= tokenRecord.expiresAt.getTime()) {
		// Mark as used even though expired
		await db
			.update(table.magicLinkToken)
			.set({ used: true, usedAt: new Date() })
			.where(eq(table.magicLinkToken.id, tokenRecord.id));
		throw new Error('Token has expired. Please request a new magic link.');
	}

	// Mark token as used
	await db
		.update(table.magicLinkToken)
		.set({ used: true, usedAt: new Date() })
		.where(eq(table.magicLinkToken.id, tokenRecord.id));

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

	// Find or create user
	let user = await db
		.select()
		.from(table.user)
		.where(eq(table.user.email, tokenRecord.email))
		.limit(1)
		.then((users) => users[0] || null);

	if (!user) {
		// Create new user with a dummy password hash (they'll use magic links)
		// Extract name from email or use client name
		const emailParts = tokenRecord.email.split('@');
		const firstName = client.name.split(' ')[0] || emailParts[0];
		const lastName = client.name.split(' ').slice(1).join(' ') || '';

		const userId = generateUserId();
		const dummyPasswordHash = await hash('dummy-password-for-client-users', {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		await db.insert(table.user).values({
			id: userId,
			email: tokenRecord.email,
			firstName,
			lastName,
			passwordHash: dummyPasswordHash
		});

		user = await db
			.select()
			.from(table.user)
			.where(eq(table.user.id, userId))
			.limit(1)
			.then((users) => users[0] || null);

		if (!user) {
			throw new Error('Failed to create user');
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

	if (!existingClientUser) {
		// Create clientUser relationship
		const clientUserId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.clientUser).values({
			id: clientUserId,
			userId: user.id,
			clientId: client.id,
			tenantId: tenant.id
		});
	}

	// Create session if event is provided
	if (event) {
		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, user.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
	}

	return { success: true, userId: user.id };
}
