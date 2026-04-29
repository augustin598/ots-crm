import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, eq, gt } from 'drizzle-orm';
import {
	authenticateApiKey,
	apiKeyAuthErrorResponse,
	ApiKeyAuthError,
	type ApiKeyContext
} from './auth';
import type { ApiKeyScope } from '$lib/server/db/schema';

export type ExternalApiHandler = (
	event: RequestEvent,
	ctx: ApiKeyContext
) => Promise<{ status: number; body: unknown } | Response>;

/**
 * Wrap an external API route with API key auth + uniform JSON error handling.
 *
 * Usage:
 *   export const POST = (event) => withApiKey(event, 'campaigns:write', async (event, ctx) => {
 *     return { status: 201, body: { ... } };
 *   });
 */
export async function withApiKey(
	event: RequestEvent,
	scope: ApiKeyScope,
	handler: ExternalApiHandler
): Promise<Response> {
	const headerValue = event.request.headers.get('x-api-key');
	let ctx: ApiKeyContext;
	try {
		ctx = await authenticateApiKey(headerValue, scope);
	} catch (err) {
		if (err instanceof ApiKeyAuthError) return apiKeyAuthErrorResponse(err);
		return new Response(
			JSON.stringify({ error: 'auth_internal_error', message: 'Authentication failed' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	try {
		const result = await handler(event, ctx);
		if (result instanceof Response) return result;
		return new Response(JSON.stringify(result.body), {
			status: result.status,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return new Response(
			JSON.stringify({ error: 'internal_error', message }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

const IDEMPOTENCY_TTL_DAYS = 7;
const IN_FLIGHT_LOCK_TTL_MS = 60_000;

// In-process per-(tenantId+key) lock — prevents two concurrent requests with
// the same Idempotency-Key from both running the handler before the first
// finishes writing its response. Sufficient for single-instance CRM; if we
// scale horizontally we'll switch to Redis.
const inFlightLocks = new Map<string, { acquiredAt: number; promise: Promise<void> }>();

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

async function acquireLock(key: string): Promise<() => void> {
	while (true) {
		const existing = inFlightLocks.get(key);
		if (!existing) break;
		if (Date.now() - existing.acquiredAt > IN_FLIGHT_LOCK_TTL_MS) {
			inFlightLocks.delete(key);
			break;
		}
		try {
			await existing.promise;
		} catch {
			// previous holder failed; loop again to acquire
		}
	}
	let release: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		release = () => {
			inFlightLocks.delete(key);
			resolve();
		};
	});
	inFlightLocks.set(key, { acquiredAt: Date.now(), promise });
	return release;
}

export interface IdempotentResult {
	status: number;
	body: unknown;
}

/**
 * Wrap a mutation handler with idempotency replay logic.
 *
 *   - If `Idempotency-Key` header is missing, the handler runs without dedup.
 *   - If a prior request with the same key returned a final response, it's replayed.
 *   - If a prior request is in-flight, this call blocks on the lock then replays.
 *   - Otherwise the handler runs, the response is cached for 7 days, and returned.
 */
export async function withIdempotency<T extends IdempotentResult>(
	event: RequestEvent,
	ctx: ApiKeyContext,
	handler: () => Promise<T>
): Promise<Response> {
	const idempotencyKey = event.request.headers.get('idempotency-key');

	if (!idempotencyKey) {
		const result = await handler();
		return new Response(JSON.stringify(result.body), {
			status: result.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const lockKey = `${ctx.tenantId}:${idempotencyKey}`;

	// Cheap fast-path: if a final response is already cached, replay immediately.
	const cached = await loadIdempotency(ctx.tenantId, idempotencyKey);
	if (cached && cached.responseStatus !== 0) {
		return new Response(cached.responseJson, {
			status: cached.responseStatus,
			headers: { 'Content-Type': 'application/json', 'Idempotency-Replay': '1' }
		});
	}

	const release = await acquireLock(lockKey);
	try {
		// Re-check after acquiring lock — another waiter may have just finished.
		const recheck = await loadIdempotency(ctx.tenantId, idempotencyKey);
		if (recheck && recheck.responseStatus !== 0) {
			return new Response(recheck.responseJson, {
				status: recheck.responseStatus,
				headers: { 'Content-Type': 'application/json', 'Idempotency-Replay': '1' }
			});
		}

		// Insert/update an in-flight marker (responseStatus=0).
		const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000);
		await upsertIdempotency({
			tenantId: ctx.tenantId,
			apiKeyId: ctx.apiKeyId,
			idempotencyKey,
			responseStatus: 0,
			responseJson: '{}',
			expiresAt
		});

		const result = await handler();
		const bodyText = JSON.stringify(result.body);

		await upsertIdempotency({
			tenantId: ctx.tenantId,
			apiKeyId: ctx.apiKeyId,
			idempotencyKey,
			responseStatus: result.status,
			responseJson: bodyText,
			expiresAt
		});

		return new Response(bodyText, {
			status: result.status,
			headers: { 'Content-Type': 'application/json' }
		});
	} finally {
		release();
	}
}

async function loadIdempotency(
	tenantId: string,
	key: string
): Promise<{ responseStatus: number; responseJson: string } | null> {
	const now = new Date();
	const [row] = await db
		.select({
			responseStatus: table.campaignIdempotency.responseStatus,
			responseJson: table.campaignIdempotency.responseJson
		})
		.from(table.campaignIdempotency)
		.where(
			and(
				eq(table.campaignIdempotency.tenantId, tenantId),
				eq(table.campaignIdempotency.idempotencyKey, key),
				gt(table.campaignIdempotency.expiresAt, now)
			)
		)
		.limit(1);
	return row ?? null;
}

async function upsertIdempotency(input: {
	tenantId: string;
	apiKeyId: string;
	idempotencyKey: string;
	responseStatus: number;
	responseJson: string;
	expiresAt: Date;
}): Promise<void> {
	const [existing] = await db
		.select({ id: table.campaignIdempotency.id })
		.from(table.campaignIdempotency)
		.where(
			and(
				eq(table.campaignIdempotency.tenantId, input.tenantId),
				eq(table.campaignIdempotency.idempotencyKey, input.idempotencyKey)
			)
		)
		.limit(1);

	if (existing) {
		await db
			.update(table.campaignIdempotency)
			.set({
				responseStatus: input.responseStatus,
				responseJson: input.responseJson,
				expiresAt: input.expiresAt
			})
			.where(eq(table.campaignIdempotency.id, existing.id));
	} else {
		await db.insert(table.campaignIdempotency).values({
			id: generateId(),
			tenantId: input.tenantId,
			apiKeyId: input.apiKeyId,
			idempotencyKey: input.idempotencyKey,
			responseStatus: input.responseStatus,
			responseJson: input.responseJson,
			expiresAt: input.expiresAt
		});
	}
}
