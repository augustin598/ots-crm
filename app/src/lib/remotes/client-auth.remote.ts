import * as v from 'valibot';
import { command } from '$app/server';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase64url, encodeBase32LowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { sendMagicLinkEmail } from '$lib/server/email';
import { verifyMagicLinkToken } from '$lib/server/client-auth';
import { env as publicEnv } from '$env/dynamic/public';

const MAGIC_LINK_EXPIRY_HOURS = 24;

function generateMagicLinkToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return encodeBase64url(bytes);
}

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

/**
 * Client signup - validates CUI + email, finds client, creates magic link token, sends email
 */
export const clientSignup = command(
	v.object({
		tenantSlug: v.pipe(v.string(), v.minLength(1, 'Tenant slug is required')),
		cui: v.pipe(v.string(), v.minLength(1, 'CUI is required')),
		email: v.pipe(v.string(), v.email('Invalid email address'))
	}),
	async ({ tenantSlug, cui, email }) => {
		try {
			// Find tenant by slug
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.slug, tenantSlug))
				.limit(1);

			if (!tenant) {
				throw new Error('Tenant not found');
			}

			// Find client by CUI in this tenant
			const [client] = await db
				.select()
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenant.id), eq(table.client.cui, cui)))
				.limit(1);

			if (!client) {
				throw new Error('Client not found with this CUI. Please contact your administrator.');
			}

			// Verify email matches either primary or secondary (don't overwrite primary email)
			const emailLower = email.toLowerCase();
			const isPrimaryMatch = client.email?.toLowerCase() === emailLower;
			if (!isPrimaryMatch) {
				const [secondary] = await db
					.select()
					.from(table.clientSecondaryEmail)
					.where(
						and(
							eq(table.clientSecondaryEmail.clientId, client.id),
							eq(table.clientSecondaryEmail.tenantId, tenant.id),
							eq(sql`lower(${table.clientSecondaryEmail.email})`, emailLower)
						)
					)
					.limit(1);
				if (!secondary && client.email) {
					throw new Error('Email does not match this client. Please use the email your administrator has configured.');
				}
				// If client has no email set yet, allow the signup email to be set as primary
				if (!client.email) {
					await db
						.update(table.client)
						.set({ email, updatedAt: new Date() })
						.where(eq(table.client.id, client.id));
				}
			}

			// Generate magic link token
			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

			const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

			// Store token in database
			await db.insert(table.magicLinkToken).values({
				id: tokenId,
				token: hashedToken,
				email,
				clientId: client.id,
				tenantId: tenant.id,
				expiresAt,
				used: false
			});

			// Send magic link email
			try {
				await sendMagicLinkEmail(email, plainToken, tenantSlug, client.name);
			} catch (emailError) {
				console.error('Failed to send magic link email:', emailError);
				// Don't throw - token is created, user can request another link
			}

			return { success: true, message: 'Magic link sent to your email' };
		} catch (error) {
			console.error('Client signup error:', error);
			const message = error instanceof Error ? error.message : 'Signup failed';
			throw new Error(message);
		}
	}
);

/**
 * Request magic link - for existing clients to request new magic link
 */
export const requestMagicLink = command(
	v.object({
		tenantSlug: v.pipe(v.string(), v.minLength(1, 'Tenant slug is required')),
		email: v.pipe(v.string(), v.email('Invalid email address'))
	}),
	async ({ tenantSlug, email }) => {
		try {
			// Find tenant by slug
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.slug, tenantSlug))
				.limit(1);

			if (!tenant) {
				throw new Error('Tenant not found');
			}

			// Find client by primary email in this tenant (case-insensitive)
			let [client] = await db
				.select()
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenant.id), eq(sql`lower(${table.client.email})`, email.toLowerCase())))
				.limit(1);

			// If not found by primary email, check secondary emails
			if (!client) {
				const [secondary] = await db
					.select({ client: table.client })
					.from(table.clientSecondaryEmail)
					.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
					.where(
						and(
							eq(table.clientSecondaryEmail.tenantId, tenant.id),
							eq(sql`lower(${table.clientSecondaryEmail.email})`, email.toLowerCase())
						)
					)
					.limit(1);
				if (secondary) {
					client = secondary.client;
				}
			}

			if (!client) {
				// Don't reveal if client exists or not for security
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Generate magic link token
			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

			const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

			// Store token in database
			await db.insert(table.magicLinkToken).values({
				id: tokenId,
				token: hashedToken,
				email,
				clientId: client.id,
				tenantId: tenant.id,
				expiresAt,
				used: false
			});

			// Send magic link email
			try {
				await sendMagicLinkEmail(email, plainToken, tenantSlug, client.name);
			} catch (emailError) {
				console.error('Failed to send magic link email:', emailError);
				throw new Error('Failed to send email. Please try again later.');
			}

			return { success: true, message: 'Magic link sent to your email' };
		} catch (error) {
			console.error('Request magic link error:', error);
			const message = error instanceof Error ? error.message : 'Request failed';
			throw new Error(message);
		}
	}
);

/**
 * Admin: Generate a magic link URL for a client (does not send email)
 * Requires: client must have email set
 */
export const generateClientMagicLink = command(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;
		const tenantSlug = event.locals.tenant.slug;

		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) throw new Error('Client not found');
		if (!client.email)
			throw new Error(
				'Clientul nu are email configurat. Adaugă un email înainte de a genera un magic link.'
			);

		const plainToken = generateMagicLinkToken();
		const hashedToken = hashToken(plainToken);
		const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

		await db.insert(table.magicLinkToken).values({
			id: tokenId,
			token: hashedToken,
			email: client.email,
			clientId: client.id,
			tenantId,
			expiresAt,
			used: false
		});

		const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
		const url = `${baseUrl}/client/${tenantSlug}/verify?token=${encodeURIComponent(plainToken)}`;
		return { url, email: client.email, expiresAt };
	}
);

/**
 * Admin: Generate a new magic link and send it to the client's email
 */
export const sendClientMagicLinkEmail = command(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;
		const tenantSlug = event.locals.tenant.slug;

		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) throw new Error('Client not found');
		if (!client.email) throw new Error('Clientul nu are email configurat.');

		const plainToken = generateMagicLinkToken();
		const hashedToken = hashToken(plainToken);
		const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

		await db.insert(table.magicLinkToken).values({
			id: tokenId,
			token: hashedToken,
			email: client.email,
			clientId: client.id,
			tenantId,
			expiresAt,
			used: false
		});

		await sendMagicLinkEmail(client.email, plainToken, tenantSlug, client.name);
		return { sent: true, email: client.email };
	}
);

/**
 * Verify magic link - verifies token, creates/updates user, creates clientUser relationship, creates session
 */
export const verifyMagicLink = command(
	v.object({
		tenantSlug: v.pipe(v.string(), v.minLength(1, 'Tenant slug is required')),
		token: v.pipe(v.string(), v.minLength(1, 'Token is required'))
	}),
	async ({ tenantSlug, token }) => {
		const event = getRequestEvent();
		if (!event) {
			throw new Error('Request event not available');
		}

		try {
			return await verifyMagicLinkToken(tenantSlug, token, event);
		} catch (error) {
			console.error('Verify magic link error:', error);
			const message = error instanceof Error ? error.message : 'Verification failed';
			throw new Error(message);
		}
	}
);
