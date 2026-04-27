import * as v from 'valibot';
import { query, command } from '$app/server';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { encodeBase64url, encodeBase32LowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { sendMagicLinkEmail } from '$lib/server/email';
import { verifyMagicLinkToken } from '$lib/server/client-auth';
import { checkAuthRateLimit } from '$lib/server/rate-limiter';
import { logInfo } from '$lib/server/logger';
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
			// Rate limiting
			const event = getRequestEvent();
			const clientIp = event ? event.getClientAddress() : null;
			const rateLimitError = checkAuthRateLimit(email, clientIp);
			if (rateLimitError) {
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Find tenant by slug
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.slug, tenantSlug))
				.limit(1);

			if (!tenant) {
				// SECURITY: Return generic message to prevent tenant enumeration
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Find client by CUI in this tenant
			const [client] = await db
				.select()
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenant.id), eq(table.client.cui, cui)))
				.limit(1);

			if (!client) {
				// SECURITY: Return generic message to prevent CUI enumeration
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Verify email matches either primary or secondary.
			// Secondary emails work even when client.email is null (admin may register
			// a contact via secondary first, before primary is set).
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
				if (!secondary) {
					// SECURITY: Return generic message to prevent email enumeration
					return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
				}
			}

			// Invalidate any existing unused tokens for this email+tenant
			const normalizedEmail = email.toLowerCase();
			await db
				.update(table.magicLinkToken)
				.set({ used: true, usedAt: new Date() })
				.where(
					and(
						eq(table.magicLinkToken.email, normalizedEmail),
						eq(table.magicLinkToken.tenantId, tenant.id),
						eq(table.magicLinkToken.used, false)
					)
				);

			// Generate magic link token
			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

			const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

			await db.insert(table.magicLinkToken).values({
				id: tokenId,
				token: hashedToken,
				email: normalizedEmail,
				clientId: client.id,
				matchedClientIds: JSON.stringify([client.id]),
				tenantId: tenant.id,
				expiresAt,
				used: false
			});

			// Send magic link email
			try {
				await sendMagicLinkEmail(normalizedEmail, plainToken, tenantSlug, client.name);
			} catch (emailError) {
				console.error('Failed to send magic link email:', emailError);
				throw new Error('Nu am putut trimite email-ul. Încearcă din nou.');
			}

			return { success: true, message: 'Magic link sent to your email' };
		} catch (error) {
			console.error('Client signup error:', error);
			// Return generic message to prevent leaking internal errors
			return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
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
			// Rate limiting
			const event = getRequestEvent();
			const clientIp = event ? event.getClientAddress() : null;
			const rateLimitError = checkAuthRateLimit(email, clientIp);
			if (rateLimitError) {
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Find tenant by slug
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.slug, tenantSlug))
				.limit(1);


			if (!tenant) {
				// SECURITY: generic response prevents tenant enumeration via this endpoint
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Find ALL clients matching this email in the tenant (primary OR secondary).
			// Snapshot is stored in token to prevent auto-link to clients created after request.
			const normalizedEmail = email.toLowerCase();
			const primaryMatches = await db
				.select({ id: table.client.id, name: table.client.name })
				.from(table.client)
				.where(
					and(
						eq(table.client.tenantId, tenant.id),
						eq(sql`lower(${table.client.email})`, normalizedEmail)
					)
				);

			const secondaryMatches = await db
				.select({ id: table.client.id, name: table.client.name })
				.from(table.clientSecondaryEmail)
				.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
				.where(
					and(
						eq(table.clientSecondaryEmail.tenantId, tenant.id),
						eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
					)
				);

			// Deduplicate by id (a client could match via both primary and secondary)
			const idSet = new Set<string>();
			const matched: { id: string; name: string }[] = [];
			for (const m of [...primaryMatches, ...secondaryMatches]) {
				if (!idSet.has(m.id)) {
					idSet.add(m.id);
					matched.push(m);
				}
			}

			if (matched.length === 0) {
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			// Invalidate any existing unused tokens for this email+tenant
			await db
				.update(table.magicLinkToken)
				.set({ used: true, usedAt: new Date() })
				.where(
					and(
						eq(table.magicLinkToken.email, normalizedEmail),
						eq(table.magicLinkToken.tenantId, tenant.id),
						eq(table.magicLinkToken.used, false)
					)
				);

			// Generate magic link token
			const plainToken = generateMagicLinkToken();
			const hashedToken = hashToken(plainToken);
			const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

			const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

			await db.insert(table.magicLinkToken).values({
				id: tokenId,
				token: hashedToken,
				email: normalizedEmail,
				clientId: matched[0].id, // backward compat: first matched client
				matchedClientIds: JSON.stringify(matched.map((m) => m.id)),
				tenantId: tenant.id,
				expiresAt,
				used: false
			});

			// Send magic link email — use first client's name as label (the email lists all on selection page)
			try {
				await sendMagicLinkEmail(normalizedEmail, plainToken, tenantSlug, matched[0].name);
			} catch (emailError) {
				console.error('Failed to send magic link email:', emailError);
				// SECURITY: still return generic success to avoid signaling that the email exists
				return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
			}

			return { success: true, message: 'Magic link sent to your email' };
		} catch (error) {
			console.error('Request magic link error:', error);
			// SECURITY: do not leak internal error messages to client
			return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
		}
	}
);

/**
 * Authorization helper: only owner or admin tenant users may issue magic links
 * on behalf of clients. A `member` role can read but not impersonate.
 */
function assertTenantAdmin(event: ReturnType<typeof getRequestEvent>): void {
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const tenantUser = event.locals.tenantUser;
	if (!tenantUser || (tenantUser.role !== 'owner' && tenantUser.role !== 'admin')) {
		throw new Error('Doar administratorii pot genera magic link-uri');
	}
}

/**
 * Admin: Generate a magic link URL for a client (does not send email)
 * Requires: client must have email set
 */
export const generateClientMagicLink = command(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		assertTenantAdmin(event);

		const tenantId = event!.locals.tenant!.id;
		const tenantSlug = event!.locals.tenant!.slug;

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
			email: client.email.toLowerCase(),
			clientId: client.id,
			matchedClientIds: JSON.stringify([client.id]),
			tenantId,
			expiresAt,
			used: false
		});

		logInfo('email', 'Admin generated magic link for client (no email)', {
			tenantId,
			metadata: { clientId, clientEmail: client.email, adminUserId: event!.locals.user!.id, mode: 'single' }
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
		assertTenantAdmin(event);

		const tenantId = event!.locals.tenant!.id;
		const tenantSlug = event!.locals.tenant!.slug;

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
			email: client.email.toLowerCase(),
			clientId: client.id,
			matchedClientIds: JSON.stringify([client.id]),
			tenantId,
			expiresAt,
			used: false
		});

		await sendMagicLinkEmail(client.email.toLowerCase(), plainToken, tenantSlug, client.name);
		logInfo('email', `Admin sent magic link to client`, {
			tenantId,
			metadata: { clientId, clientEmail: client.email, adminUserId: event!.locals.user!.id }
		});
		return { sent: true, email: client.email };
	}
);

/**
 * Admin: list every client in the tenant whose primary or secondary email
 * matches THIS client's primary email. Used to decide whether to show the
 * multi-company magic link button on the client detail page (only when the
 * email reaches >= 2 clients).
 */
export const getClientLinkedCompanies = query(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		// Read-only listing — any tenantUser may view, but reject cross-tenant probes.
		if (!event.locals.tenantUser) throw new Error('Acces interzis pentru acest tenant');
		const tenantId = event.locals.tenant.id;

		const [client] = await db
			.select({ id: table.client.id, email: table.client.email })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) return { email: null, companies: [] };
		if (!client.email) return { email: null, companies: [] };

		const normalizedEmail = client.email.toLowerCase();

		const primaryMatches = await db
			.select({ id: table.client.id, name: table.client.name, cui: table.client.cui })
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					eq(sql`lower(${table.client.email})`, normalizedEmail)
				)
			);

		const secondaryMatches = await db
			.select({ id: table.client.id, name: table.client.name, cui: table.client.cui })
			.from(table.clientSecondaryEmail)
			.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
			.where(
				and(
					eq(table.clientSecondaryEmail.tenantId, tenantId),
					eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
				)
			);

		const seen = new Set<string>();
		const companies: { id: string; name: string; cui: string | null }[] = [];
		for (const m of [...primaryMatches, ...secondaryMatches]) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			companies.push(m);
		}

		return { email: normalizedEmail, companies };
	}
);

/**
 * Admin: generate a multi-company magic link URL for a client. Snapshots
 * EVERY client whose primary or secondary email is the same as this
 * client's primary email — at the next /verify step the user will see
 * the company selector with all matched companies.
 */
export const generateClientMultiCompanyMagicLink = command(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		assertTenantAdmin(event);
		const tenantId = event!.locals.tenant!.id;
		const tenantSlug = event!.locals.tenant!.slug;

		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) throw new Error('Client not found');
		if (!client.email) throw new Error('Clientul nu are email configurat.');

		const normalizedEmail = client.email.toLowerCase();

		const primaryMatches = await db
			.select({ id: table.client.id, name: table.client.name })
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					eq(sql`lower(${table.client.email})`, normalizedEmail)
				)
			);

		const secondaryMatches = await db
			.select({ id: table.client.id, name: table.client.name })
			.from(table.clientSecondaryEmail)
			.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
			.where(
				and(
					eq(table.clientSecondaryEmail.tenantId, tenantId),
					eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
				)
			);

		const seen = new Set<string>();
		const matched: { id: string; name: string }[] = [];
		for (const m of [...primaryMatches, ...secondaryMatches]) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			matched.push(m);
		}

		if (matched.length < 2) {
			throw new Error(
				'Acest email aparține unei singure firme. Folosește butonul Magic Link standard.'
			);
		}

		const plainToken = generateMagicLinkToken();
		const hashedToken = hashToken(plainToken);
		const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

		await db.insert(table.magicLinkToken).values({
			id: tokenId,
			token: hashedToken,
			email: normalizedEmail,
			clientId: matched[0].id,
			matchedClientIds: JSON.stringify(matched.map((m) => m.id)),
			tenantId,
			expiresAt,
			used: false
		});

		logInfo('email', 'Admin generated multi-company magic link for client (no email)', {
			tenantId,
			metadata: {
				clientId,
				clientEmail: normalizedEmail,
				matchedCount: matched.length,
				adminUserId: event!.locals.user!.id,
				mode: 'multi'
			}
		});

		const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
		const url = `${baseUrl}/client/${tenantSlug}/verify?token=${encodeURIComponent(plainToken)}`;
		return { url, email: normalizedEmail, matchedCount: matched.length, matched, expiresAt };
	}
);

/**
 * Admin: generate + email a multi-company magic link to the client's email.
 */
export const sendClientMultiCompanyMagicLinkEmail = command(
	v.object({ clientId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ clientId }) => {
		const event = getRequestEvent();
		assertTenantAdmin(event);
		const tenantId = event!.locals.tenant!.id;
		const tenantSlug = event!.locals.tenant!.slug;

		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) throw new Error('Client not found');
		if (!client.email) throw new Error('Clientul nu are email configurat.');

		const normalizedEmail = client.email.toLowerCase();

		const primaryMatches = await db
			.select({ id: table.client.id, name: table.client.name })
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					eq(sql`lower(${table.client.email})`, normalizedEmail)
				)
			);

		const secondaryMatches = await db
			.select({ id: table.client.id, name: table.client.name })
			.from(table.clientSecondaryEmail)
			.innerJoin(table.client, eq(table.clientSecondaryEmail.clientId, table.client.id))
			.where(
				and(
					eq(table.clientSecondaryEmail.tenantId, tenantId),
					eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
				)
			);

		const seen = new Set<string>();
		const matched: { id: string; name: string }[] = [];
		for (const m of [...primaryMatches, ...secondaryMatches]) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			matched.push(m);
		}

		if (matched.length < 2) {
			throw new Error(
				'Acest email aparține unei singure firme. Folosește butonul Magic Link standard.'
			);
		}

		const plainToken = generateMagicLinkToken();
		const hashedToken = hashToken(plainToken);
		const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

		await db.insert(table.magicLinkToken).values({
			id: tokenId,
			token: hashedToken,
			email: normalizedEmail,
			clientId: matched[0].id,
			matchedClientIds: JSON.stringify(matched.map((m) => m.id)),
			tenantId,
			expiresAt,
			used: false
		});

		// The email subject uses the first matched client's name as a label.
		// The recipient lands on /select-company and picks any of the matched.
		await sendMagicLinkEmail(normalizedEmail, plainToken, tenantSlug, matched[0].name);
		logInfo('email', `Admin sent multi-company magic link to client`, {
			tenantId,
			metadata: {
				clientId,
				clientEmail: normalizedEmail,
				matchedCount: matched.length,
				adminUserId: event!.locals.user!.id
			}
		});
		return { sent: true, email: normalizedEmail, matchedCount: matched.length };
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
