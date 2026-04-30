import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase, encodeBase64url, encodeBase32LowerCase } from '@oslojs/encoding';
import { verifyMagicLinkToken } from '$lib/server/client-auth';
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestHandler } from './$types';

/**
 * Debug endpoint for the multi-company magic link flow.
 *
 * Admin-only. Hard-coded test fixture: two clients with shared email
 * george@beoneconcept.ro reachable on both via primary OR secondary.
 *
 * Endpoints:
 *   GET                   → snapshot of fixture (clients, secondary emails, clientUser links, recent tokens)
 *   POST ?action=setup    → ensures george@beoneconcept.ro is reachable on BOTH fixtures
 *                           (adds it as a secondary on the one whose primary is different).
 *   POST ?action=request  → simulates requestMagicLink: returns the magic link URL
 *                           (so you can open it in another browser without the email step).
 *   POST ?action=verify   → consumes the latest magic link token and reports the
 *                           outcome (clientCount, activeClientId, redirect target,
 *                           clientUser rows created, /select-company contents).
 *   POST ?action=cleanup  → reverses setup: removes the secondary email, drops
 *                           any clientUser rows + tokens for the test email so
 *                           you can re-run the scenario from scratch.
 */

const TEST_CUIS = ['31008047', '34278142'];
const TEST_EMAIL = 'george@beoneconcept.ro';
const MAGIC_LINK_EXPIRY_HOURS = 24;

function assertAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Admin only');
	}
}

async function getFixtureClients(tenantId: string) {
	const cuis = TEST_CUIS.flatMap((c) => [c, `RO${c}`]);
	const clients = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), inArray(table.client.cui, cuis)));
	return clients;
}

async function snapshot(tenantId: string) {
	const clients = await getFixtureClients(tenantId);
	const clientIds = clients.map((c) => c.id);
	const normalizedEmail = TEST_EMAIL.toLowerCase();

	const secondaries =
		clientIds.length === 0
			? []
			: await db
					.select()
					.from(table.clientSecondaryEmail)
					.where(
						and(
							eq(table.clientSecondaryEmail.tenantId, tenantId),
							inArray(table.clientSecondaryEmail.clientId, clientIds)
						)
					);

	const [user] = await db
		.select()
		.from(table.user)
		.where(eq(table.user.email, normalizedEmail))
		.limit(1);

	const clientUsers = user
		? await db
				.select({
					id: table.clientUser.id,
					clientId: table.clientUser.clientId,
					isPrimary: table.clientUser.isPrimary,
					lastSelectedAt: table.clientUser.lastSelectedAt,
					createdAt: table.clientUser.createdAt
				})
				.from(table.clientUser)
				.where(
					and(
						eq(table.clientUser.userId, user.id),
						eq(table.clientUser.tenantId, tenantId)
					)
				)
		: [];

	const recentTokens = await db
		.select({
			id: table.magicLinkToken.id,
			email: table.magicLinkToken.email,
			clientId: table.magicLinkToken.clientId,
			matchedClientIds: table.magicLinkToken.matchedClientIds,
			used: table.magicLinkToken.used,
			usedAt: table.magicLinkToken.usedAt,
			createdAt: table.magicLinkToken.createdAt,
			expiresAt: table.magicLinkToken.expiresAt
		})
		.from(table.magicLinkToken)
		.where(
			and(
				eq(table.magicLinkToken.tenantId, tenantId),
				eq(table.magicLinkToken.email, normalizedEmail)
			)
		)
		.orderBy(sql`${table.magicLinkToken.createdAt} DESC`)
		.limit(5);

	return {
		clients: clients.map((c) => ({
			id: c.id,
			name: c.name,
			businessName: c.businessName,
			cui: c.cui,
			email: c.email,
			status: c.status
		})),
		secondaryEmails: secondaries.map((s) => ({
			id: s.id,
			clientId: s.clientId,
			email: s.email,
			label: s.label
		})),
		userId: user?.id ?? null,
		clientUsers,
		recentTokens
	};
}

export const GET: RequestHandler = async (event) => {
	assertAdmin(event);
	return json(await snapshot(event.locals.tenant!.id));
};

export const POST: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const tenantSlug = event.locals.tenant!.slug;
	const action = event.url.searchParams.get('action');
	const normalizedEmail = TEST_EMAIL.toLowerCase();

	if (action === 'setup') {
		const clients = await getFixtureClients(tenantId);
		if (clients.length !== TEST_CUIS.length) {
			throw error(404, `Expected ${TEST_CUIS.length} fixture clients, found ${clients.length}`);
		}

		const result: Array<{ clientId: string; name: string; action: string }> = [];

		for (const client of clients) {
			const primaryMatches = client.email?.toLowerCase() === normalizedEmail;
			if (primaryMatches) {
				result.push({ clientId: client.id, name: client.name, action: 'already-primary' });
				continue;
			}

			// Already a secondary?
			const [existing] = await db
				.select({ id: table.clientSecondaryEmail.id })
				.from(table.clientSecondaryEmail)
				.where(
					and(
						eq(table.clientSecondaryEmail.clientId, client.id),
						eq(table.clientSecondaryEmail.tenantId, tenantId),
						eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
					)
				)
				.limit(1);

			if (existing) {
				result.push({ clientId: client.id, name: client.name, action: 'already-secondary' });
				continue;
			}

			const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.clientSecondaryEmail).values({
				id,
				tenantId,
				clientId: client.id,
				email: normalizedEmail,
				label: 'Test multi-company',
				notifyInvoices: false,
				notifyTasks: false,
				notifyContracts: false,
				createdAt: new Date(),
				updatedAt: new Date()
			});
			result.push({ clientId: client.id, name: client.name, action: 'added-secondary' });
		}

		return json({ ok: true, action, result, snapshot: await snapshot(tenantId) });
	}

	if (action === 'request') {
		// Mirror requestMagicLink without going through the rate limiter
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
			if (!seen.has(m.id)) {
				seen.add(m.id);
				matched.push(m);
			}
		}

		if (matched.length === 0) {
			return json({ ok: false, error: 'No clients matched on this email' }, { status: 404 });
		}

		// Invalidate previous unused tokens
		await db
			.update(table.magicLinkToken)
			.set({ used: true, usedAt: new Date() })
			.where(
				and(
					eq(table.magicLinkToken.email, normalizedEmail),
					eq(table.magicLinkToken.tenantId, tenantId),
					eq(table.magicLinkToken.used, false)
				)
			);

		const plainBytes = crypto.getRandomValues(new Uint8Array(32));
		const plainToken = encodeBase64url(plainBytes);
		const hashedToken = encodeHexLowerCase(sha256(new TextEncoder().encode(plainToken)));
		const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);
		const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

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

		const baseUrl = publicEnv.PUBLIC_APP_URL || `${event.url.protocol}//${event.url.host}`;
		const magicLink = `${baseUrl}/client/${tenantSlug}/verify?token=${encodeURIComponent(plainToken)}`;

		return json({
			ok: true,
			action,
			matchedCount: matched.length,
			matched,
			plainToken,
			magicLink,
			expiresAt
		});
	}

	if (action === 'verify') {
		const tokenParam = event.url.searchParams.get('token');
		if (!tokenParam) {
			throw error(400, 'token query param required');
		}
		try {
			const result = await verifyMagicLinkToken(tenantSlug, tokenParam);
			const target =
				result.clientCount > 1
					? `/client/${tenantSlug}/select-company`
					: `/client/${tenantSlug}/dashboard`;
			return json({ ok: true, action, result, redirectTarget: target, snapshot: await snapshot(tenantId) });
		} catch (err) {
			return json(
				{ ok: false, action, error: err instanceof Error ? err.message : String(err) },
				{ status: 400 }
			);
		}
	}

	if (action === 'cleanup') {
		const clients = await getFixtureClients(tenantId);
		const clientIds = clients.map((c) => c.id);

		// Remove the test secondary email rows we added
		const removedSecondaries = clientIds.length
			? await db
					.delete(table.clientSecondaryEmail)
					.where(
						and(
							eq(table.clientSecondaryEmail.tenantId, tenantId),
							inArray(table.clientSecondaryEmail.clientId, clientIds),
							eq(sql`lower(${table.clientSecondaryEmail.email})`, normalizedEmail)
						)
					)
			: { rowsAffected: 0 };

		// Drop the test user's clientUser links so the next login re-creates them fresh
		const [user] = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(table.user.email, normalizedEmail))
			.limit(1);

		const removedCu = user
			? await db
					.delete(table.clientUser)
					.where(
						and(
							eq(table.clientUser.userId, user.id),
							eq(table.clientUser.tenantId, tenantId),
							inArray(table.clientUser.clientId, clientIds)
						)
					)
			: { rowsAffected: 0 };

		// Drop magic link tokens for this email in this tenant
		const removedTokens = await db
			.delete(table.magicLinkToken)
			.where(
				and(
					eq(table.magicLinkToken.tenantId, tenantId),
					eq(table.magicLinkToken.email, normalizedEmail)
				)
			);

		return json({
			ok: true,
			action,
			removedSecondaries: (removedSecondaries as { rowsAffected?: number }).rowsAffected ?? 0,
			removedClientUsers: (removedCu as { rowsAffected?: number }).rowsAffected ?? 0,
			removedTokens: (removedTokens as { rowsAffected?: number }).rowsAffected ?? 0,
			snapshot: await snapshot(tenantId)
		});
	}

	throw error(400, `Unknown action: ${action ?? '(missing)'}. Use setup | request | verify | cleanup.`);
};
