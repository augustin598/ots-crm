import * as v from 'valibot';
import { command, query } from '$app/server';
import { lucia } from '../server/lucia';
import { db } from '../server/db';
import { user, adminMagicLinkToken } from '../server/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { encodeBase32LowerCase, encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import type { User } from '../server/db/schema';
import { sendAdminMagicLinkEmail } from '../server/email';
import { verifyAdminMagicLinkToken } from '../server/auth';
import { generateSessionToken, createSession, setSessionTokenCookie, invalidateSession, deleteSessionTokenCookie } from '../server/auth';


function generateUserId(): string {
	const bytes = randomBytes(15);
	return encodeBase32LowerCase(bytes);
}

function generateToken(): string {
	return randomBytes(32).toString('hex');
}

function generateMagicLinkToken(): string {
	const bytes = randomBytes(32);
	return encodeBase64url(bytes);
}

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

const MAGIC_LINK_EXPIRY_HOURS = 24;

/**
 * Register a new user
 */
export const register = command(
	v.object({
		email: v.pipe(v.string(), v.email('Invalid email address')),
		firstName: v.pipe(v.string(), v.minLength(1, 'First name is required')),
		lastName: v.pipe(v.string(), v.minLength(1, 'Last name is required')),
		password: v.pipe(v.string(), v.minLength(6, 'Password must be at least 6 characters'))
	}),
	async ({
		email,
		firstName,
		lastName,
		password
	}): Promise<{ success: boolean; user?: User | null; userId?: string; error?: string }> => {
		try {
			// Check if email is already in use
			const [existingEmail] = await db.select().from(user).where(eq(user.email, email)).limit(1);
			if (existingEmail) {
				return { success: false, error: 'Email already registered' };
			}

			// Hash password
			const passwordHash = await hash(password, {
				memoryCost: 19456,
				timeCost: 2,
				outputLen: 32,
				parallelism: 1
			});

			// Create user
			const userId = generateUserId();

			await db.insert(user).values({
				id: userId,
				email,
				firstName,
				lastName,
				passwordHash
			});

			const userRecord = await db.select().from(user).where(eq(user.id, userId)).limit(1);

			return { success: true, user: userRecord[0] || null, userId };
		} catch (error) {
			console.error('Registration error:', error);
			return { success: false, error: 'Registration failed' };
		}
	}
);

/**
 * Login user (email-based)
 */
export const login = command(
	v.object({
		email: v.pipe(v.string(), v.email('Invalid email address')),
		password: v.pipe(v.string(), v.nonEmpty())
	}),
	async ({
		email,
		password
	}): Promise<{ success: boolean; user?: User | null; error?: string }> => {
		try {
			// Find user by email
			const [userRecord] = await db.select().from(user).where(eq(user.email, email)).limit(1);

			if (!userRecord) {
				return { success: false, error: 'Invalid email or password' };
			}

			const validPassword = await verify(userRecord.passwordHash, password, {
				memoryCost: 19456,
				timeCost: 2,
				outputLen: 32,
				parallelism: 1
			});

			if (!validPassword) {
				return { success: false, error: 'Invalid email or password' };
			}

			// Create session with custom auth system (not Lucia)
			const event = getRequestEvent();
			if (event) {
				const sessionToken = generateSessionToken();
				const session = await createSession(sessionToken, userRecord.id);
				setSessionTokenCookie(event, sessionToken, session.expiresAt);
			}

			return { success: true, user: userRecord };
		} catch (error) {
			console.error('Login error:', error);
			return { success: false, error: 'Login failed' };
		}
	}
);

/**
 * Logout user
 */
export const logout = command(v.void(), async (): Promise<{ success: boolean; error?: string }> => {
	try {
		const event = getRequestEvent();
		if (!event || !event.locals.session) {
			return { success: false, error: 'No active session' };
		}

		await invalidateSession(event.locals.session.id);

		// Clear session cookie
		deleteSessionTokenCookie(event);

		return { success: true };
	} catch (error) {
		console.error('Logout error:', error);
		return { success: false, error: 'Logout failed' };
	}
});

/**
 * Get current user
 */
export const getCurrentUser = query(
	async (): Promise<{ user?: User | null; error?: string | null }> => {
		try {
			const event = getRequestEvent();
			console.log('Event:', event);
			console.log('Session:', event?.locals.session);
			console.log('Session user:', event?.locals.session?.userId);
			const userResult = await db
				.select()
				.from(user)
				.where(eq(user.id, event?.locals.session?.userId || ''))
				.limit(1);
			if (userResult.length === 0) {
				return { user: null, error: 'User not found' };
			}
			return { user: userResult[0], error: null };
		} catch (error) {
			console.error('Get current user error:', error);
			return { user: null, error: 'Failed to get current user' };
		}
	}
);

/**
 * Request magic link for admin login
 */
export const requestMagicLink = command(
	v.object({
		email: v.pipe(v.string(), v.email('Invalid email address'))
	}),
	async ({ email }): Promise<{ success: boolean; message: string; error?: string }> => {
		try {
			// Check if user exists (but don't reveal if they don't for security)
			const [userRecord] = await db.select().from(user).where(eq(user.email, email)).limit(1);

			if (!userRecord) {
				// Don't reveal if email exists - return success message anyway
				return {
					success: true,
					message: 'If an account exists with this email, a magic link has been sent.'
				};
			}

			// Generate magic link token
			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

			const tokenId = encodeBase32LowerCase(randomBytes(15));

			// Store token in database
			await db.insert(adminMagicLinkToken).values({
				id: tokenId,
				token: hashedToken,
				email,
				expiresAt,
				used: false
			});

			// Send magic link email
			try {
				await sendAdminMagicLinkEmail(
					email,
					plainToken,
					userRecord.firstName + ' ' + userRecord.lastName
				);
			} catch (emailError) {
				console.error('Failed to send magic link email:', emailError);
				// Don't throw - token is created, user can request another link
				return {
					success: false,
					message: 'Failed to send email. Please try again later.',
					error: 'Email send failed'
				};
			}

			return {
				success: true,
				message: 'Magic link sent to your email. Please check your inbox.'
			};
		} catch (error) {
			console.error('Request magic link error:', error);
			const message = error instanceof Error ? error.message : 'Request failed';
			return { success: false, message, error: message };
		}
	}
);

/**
 * Verify magic link token and create session
 */
export const verifyMagicLink = command(
	v.object({
		token: v.pipe(v.string(), v.minLength(1, 'Token is required'))
	}),
	async ({ token }): Promise<{ success: boolean; error?: string }> => {
		try {
			const event = getRequestEvent();
			// Use the server-side helper function
			return await verifyAdminMagicLinkToken(token, event || undefined);
		} catch (error) {
			console.error('Verify magic link error:', error);
			const message = error instanceof Error ? error.message : 'Verification failed';
			return { success: false, error: message };
		}
	}
);
