import * as v from 'valibot';
import { command, query } from '$app/server';
import { lucia } from '../server/lucia';
import { db } from '../server/db';
import { user } from '../server/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import type { User } from '../server/db/schema';

function generateUserId(): string {
	const bytes = randomBytes(15);
	return encodeBase32LowerCase(bytes);
}

function generateToken(): string {
	return randomBytes(32).toString('hex');
}

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

			// Create session with Lucia
			const session = await lucia.createSession(userRecord.id, {
				email: userRecord.email,
				firstName: userRecord.firstName,
				lastName: userRecord.lastName
			});

			// Set session cookie
			const event = getRequestEvent();
			if (event) {
				const sessionCookie = lucia.createSessionCookie(session.id);
				event.cookies.set(sessionCookie.name, sessionCookie.value, {
					path: '.',
					...sessionCookie.attributes
				});
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

		// Invalidate session with Lucia
		await lucia.invalidateSession(event.locals.session.id);

		// Clear session cookie
		const sessionCookie = lucia.createBlankSessionCookie();
		event.cookies.set(sessionCookie.name, sessionCookie.value, {
			path: '.',
			...sessionCookie.attributes
		});

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
