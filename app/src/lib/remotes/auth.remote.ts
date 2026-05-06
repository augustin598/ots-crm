import * as v from 'valibot';
import { command, query } from '$app/server';
import { lucia } from '../server/lucia';
import { db } from '../server/db';
import { user, adminMagicLinkToken, passwordResetToken, tenantUser, invitation } from '../server/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { logError } from '../server/logger';
import { hash, verify } from '@node-rs/argon2';
import { encodeBase32LowerCase, encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import type { User } from '../server/db/schema';
import { sendAdminMagicLinkEmail, sendPasswordResetEmail } from '../server/email';
import { checkAuthRateLimit } from '../server/rate-limiter';
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
 * Change password for the current logged-in user
 */
export const changePassword = command(
	v.object({
		currentPassword: v.pipe(v.string(), v.minLength(1, 'Current password is required')),
		newPassword: v.pipe(v.string(), v.minLength(6, 'New password must be at least 6 characters'))
	}),
	async ({ currentPassword, newPassword }) => {
		const event = getRequestEvent();
		if (!event?.locals.user) {
			throw new Error('Not authenticated');
		}

		const [userRecord] = await db.select().from(user).where(eq(user.id, event.locals.user.id)).limit(1);
		if (!userRecord) {
			throw new Error('User not found');
		}

		const validPassword = await verify(userRecord.passwordHash, currentPassword, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		if (!validPassword) {
			throw new Error('Parola curentă este incorectă');
		}

		const passwordHash = await hash(newPassword, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		await db.update(user).set({ passwordHash }).where(eq(user.id, event.locals.user.id));
	}
);

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
			// Rate limiting
			const event = getRequestEvent();
			const clientIp = event ? event.getClientAddress() : null;
			const rateLimitError = checkAuthRateLimit(email, clientIp);
			if (rateLimitError) {
				return {
					success: true,
					message: 'If an account exists with this email, a magic link has been sent.'
				};
			}

			// Check if user exists (but don't reveal if they don't for security)
			const [userRecord] = await db.select().from(user).where(eq(user.email, email)).limit(1);

			if (!userRecord) {
				// Don't reveal if email exists - return success message anyway
				return {
					success: true,
					message: 'If an account exists with this email, a magic link has been sent.'
				};
			}

			// Invalidate any existing unused admin tokens for this email
			await db
				.update(adminMagicLinkToken)
				.set({ used: true })
				.where(
					and(
						eq(adminMagicLinkToken.email, email.toLowerCase()),
						eq(adminMagicLinkToken.used, false)
					)
				);

			// Generate magic link token
			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

			const tokenId = encodeBase32LowerCase(randomBytes(15));

			// Store token in database
			await db.insert(adminMagicLinkToken).values({
				id: tokenId,
				token: hashedToken,
				email: email.toLowerCase(),
				expiresAt,
				used: false
			});

			// Find user's primary tenant to use its email transporter (Gmail/SMTP)
			const [userTenant] = await db
				.select({ tenantId: tenantUser.tenantId })
				.from(tenantUser)
				.where(eq(tenantUser.userId, userRecord.id))
				.limit(1);

			// Send magic link email (uses tenant transporter if available, else default SMTP)
			try {
				await sendAdminMagicLinkEmail(
					email,
					plainToken,
					userRecord.firstName + ' ' + userRecord.lastName,
					userTenant?.tenantId
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

const PASSWORD_RESET_EXPIRY_HOURS = 1;

/**
 * Request password reset - sends email with reset link
 */
export const requestPasswordReset = command(
	v.object({
		email: v.pipe(v.string(), v.email('Invalid email address'))
	}),
	async ({ email }): Promise<{ success: boolean; message: string; error?: string }> => {
		try {
			// Rate limiting
			const event = getRequestEvent();
			const clientIp = event ? event.getClientAddress() : null;
			const rateLimitError = checkAuthRateLimit(email, clientIp);
			if (rateLimitError) {
				return {
					success: true,
					message: 'If an account exists with this email, a password reset link has been sent.'
				};
			}

			const normalizedEmail = email.trim().toLowerCase();
			const [userRecord] = await db
				.select()
				.from(user)
				.where(eq(user.email, normalizedEmail))
				.limit(1);

			// Generic response — never reveal whether email exists (security)
			const GENERIC_OK = {
				success: true,
				message: 'Dacă există un cont pentru acest email, a fost trimis un link de resetare.'
			};

			if (!userRecord) {
				return GENERIC_OK;
			}

			// Find user's tenant. Try active membership first, then fall back to a
			// tenant from a pending invitation (so orphan users invited to a tenant
			// can still get email via that tenant's Gmail/SMTP).
			const [activeTenant] = await db
				.select({ tenantId: tenantUser.tenantId })
				.from(tenantUser)
				.where(
					and(
						eq(tenantUser.userId, userRecord.id),
						eq(tenantUser.status, 'active')
					)
				)
				.limit(1);

			let resolvedTenantId: string | null = activeTenant?.tenantId ?? null;

			if (!resolvedTenantId) {
				// Orphan user — try to use a pending invitation's tenant
				const [pendingInv] = await db
					.select({ tenantId: invitation.tenantId })
					.from(invitation)
					.where(
						and(
							eq(invitation.email, normalizedEmail),
							eq(invitation.status, 'pending')
						)
					)
					.limit(1);
				resolvedTenantId = pendingInv?.tenantId ?? null;
			}

			if (!resolvedTenantId) {
				// Orphan account with no tenant context AND no pending invitations.
				// Don't send email — there's no useful workspace to log into anyway.
				// Return generic message (don't leak the orphan state).
				logError('auth', 'Password reset blocked for orphan account', {
					metadata: { email: normalizedEmail, userId: userRecord.id }
				});
				return GENERIC_OK;
			}

			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);
			const tokenId = encodeBase32LowerCase(randomBytes(15));

			// Invalidate any existing unused password reset tokens for this user
			await db
				.update(passwordResetToken)
				.set({ used: true })
				.where(
					and(
						eq(passwordResetToken.userId, userRecord.id),
						eq(passwordResetToken.used, false)
					)
				);

			await db.insert(passwordResetToken).values({
				id: tokenId,
				token: hashedToken,
				userId: userRecord.id,
				expiresAt
			});

			try {
				await sendPasswordResetEmail(
					email,
					plainToken,
					`${userRecord.firstName ?? ''} ${userRecord.lastName ?? ''}`.trim() || email,
					resolvedTenantId
				);
			} catch (emailError) {
				logError('auth', 'Failed to send password reset email', {
					metadata: { email: normalizedEmail, tenantId: resolvedTenantId },
					stackTrace: emailError instanceof Error ? emailError.stack : undefined
				});
				return {
					success: false,
					message: 'Trimiterea emailului a eșuat. Reîncearcă în câteva minute.',
					error: 'Email send failed'
				};
			}

			return {
				success: true,
				message: 'If an account exists with this email, a password reset link has been sent.'
			};
		} catch (error) {
			console.error('Request password reset error:', error);
			return {
				success: false,
				message: 'Request failed',
				error: error instanceof Error ? error.message : 'Request failed'
			};
		}
	}
);

/**
 * Reset password with token from email
 */
export const resetPasswordWithToken = command(
	v.object({
		token: v.pipe(v.string(), v.minLength(1, 'Token is required')),
		newPassword: v.pipe(v.string(), v.minLength(6, 'New password must be at least 6 characters'))
	}),
	async ({ token, newPassword }) => {
		const hashedToken = hashToken(token);

		const [tokenRecord] = await db
			.select()
			.from(passwordResetToken)
			.where(eq(passwordResetToken.token, hashedToken))
			.limit(1);

		if (!tokenRecord) {
			throw new Error('Invalid or expired reset link. Please request a new one.');
		}

		if (tokenRecord.used) {
			throw new Error('This reset link has already been used. Please request a new one.');
		}

		if (new Date() > tokenRecord.expiresAt) {
			throw new Error('This reset link has expired. Please request a new one.');
		}

		const passwordHash = await hash(newPassword, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		await db.transaction(async (tx) => {
			await tx.update(user).set({ passwordHash }).where(eq(user.id, tokenRecord.userId));
			await tx
				.update(passwordResetToken)
				.set({ used: true, usedAt: new Date() })
				.where(eq(passwordResetToken.id, tokenRecord.id));
		});
	}
);
