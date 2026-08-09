import type { RequestEvent } from '@sveltejs/kit';
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
 *   export const POST = (event) => withApiKey(event, 'clients:read', async (event, ctx) => {
 *     return { status: 200, body: { ... } };
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
