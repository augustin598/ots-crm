import type { RequestEvent } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { lucia } from './lucia';
import { logError, serializeError } from '$lib/server/logger';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'auth-crm';

export function generateSessionToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	const token = encodeBase64url(bytes);
	return token;
}

export async function createSession(token: string, userId: string) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const session: table.Session = {
		id: sessionId,
		userId,
		expiresAt: new Date(Date.now() + DAY_IN_MS * 30)
	};
	await db.insert(table.session).values(session);
	return session;
}

export async function validateSessionToken(token: string) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const [result] = await db
		.select({
			// Adjust user table here to tweak returned data
			user: {
				id: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			},
			session: table.session
		})
		.from(table.session)
		.innerJoin(table.user, eq(table.session.userId, table.user.id))
		.where(eq(table.session.id, sessionId));

	if (!result) {
		return { session: null, user: null };
	}
	const { session, user } = result;

	const sessionExpired = Date.now() >= session.expiresAt.getTime();
	if (sessionExpired) {
		await db.delete(table.session).where(eq(table.session.id, session.id));
		return { session: null, user: null };
	}

	const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
	if (renewSession) {
		session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);
		await db
			.update(table.session)
			.set({ expiresAt: session.expiresAt })
			.where(eq(table.session.id, session.id));
	}

	return { session, user };
}

export type SessionValidationResult = Awaited<ReturnType<typeof validateSessionToken>>;

export async function invalidateSession(sessionId: string) {
	await db.delete(table.session).where(eq(table.session.id, sessionId));
}

export function setSessionTokenCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(sessionCookieName, token, {
		expires: expiresAt,
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:'
	});
}

export function deleteSessionTokenCookie(event: RequestEvent) {
	event.cookies.delete(sessionCookieName, {
		path: '/'
	});
}

/**
 * Server-side helper function to verify admin magic link token
 * This can be called from both server load functions and commands
 */
export async function verifyAdminMagicLinkToken(
	token: string,
	event?: RequestEvent
): Promise<{ success: boolean; error?: string }> {
	function hashToken(token: string): string {
		return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	}

	try {
		// Hash the provided token
		const hashedToken = hashToken(token);

		// Find token in database
		const [tokenRecord] = await db
			.select()
			.from(table.adminMagicLinkToken)
			.where(
				and(
					eq(table.adminMagicLinkToken.token, hashedToken),
					eq(table.adminMagicLinkToken.used, false)
				)
			)
			.limit(1);

		if (!tokenRecord) {
			return { success: false, error: 'Invalid or expired token' };
		}

		// Check if token is expired
		if (Date.now() >= tokenRecord.expiresAt.getTime()) {
			// Mark as used even though expired
			await db
				.update(table.adminMagicLinkToken)
				.set({ used: true, usedAt: new Date() })
				.where(eq(table.adminMagicLinkToken.id, tokenRecord.id));
			return { success: false, error: 'Token has expired. Please request a new magic link.' };
		}

		// Mark token as used
		await db
			.update(table.adminMagicLinkToken)
			.set({ used: true, usedAt: new Date() })
			.where(eq(table.adminMagicLinkToken.id, tokenRecord.id));

		// Find user by email
		const [userRecord] = await db
			.select()
			.from(table.user)
			.where(eq(table.user.email, tokenRecord.email))
			.limit(1);

		if (!userRecord) {
			return { success: false, error: 'User not found' };
		}

		// Create session with Lucia

		// Set session cookie if event is provided
		if (event) {
			const sessionToken = generateSessionToken();
			const session = await createSession(sessionToken, userRecord.id);
			setSessionTokenCookie(event, sessionToken, session.expiresAt);
		}

		return { success: true };
	} catch (error) {
		const { message: errMsg, stack } = serializeError(error);
		logError('server', `Verify admin magic link error: ${errMsg}`, { stackTrace: stack });
		const message = error instanceof Error ? error.message : 'Verification failed';
		return { success: false, error: message };
	}
}
