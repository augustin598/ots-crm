/**
 * Direct passthrough to a DA endpoint — shows the raw response body so we can
 * adapt the wrapper when DA versions diverge from the swagger shape.
 *
 *   GET /[tenant]/api/_debug-da-raw?path=/api/search/users
 *   GET /[tenant]/api/_debug-da-raw?path=/CMD_API_SHOW_USERS
 *   GET /[tenant]/api/_debug-da-raw?path=/CMD_API_DOMAIN&user=somebody
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden');
	const tenantId = event.locals.tenant.id;
	logInfo('directadmin', 'debug-da-raw passthrough', {
		tenantId,
		action: 'debug_da_raw',
		userId: event.locals.user.id,
		metadata: {
			path: event.url.searchParams.get('path'),
			user: event.url.searchParams.get('user'),
			ip: event.getClientAddress?.() ?? null
		}
	});

	const path = event.url.searchParams.get('path');
	if (!path) throw error(400, 'Missing ?path=');

	// Hard allowlist of paths this passthrough may hit. The goal is investigative
	// (see what DA returns for a known-safe read endpoint), NOT an arbitrary
	// DA-command relay. Allowing `?path=` to be freeform turns admin compromise
	// into mass-suspend + cross-tenant SSRF (Audit MED-1).
	const ALLOWED_PATHS = new Set([
		'/api/search/users',
		'/api/admin-usage',
		'/api/session/user-usage',
		'/api/resource-usage/latest',
		'/CMD_API_SHOW_USERS',
		'/CMD_API_SHOW_USER_DOMAINS',
		'/CMD_API_SHOW_DOMAINS',
		'/CMD_API_ADDITIONAL_DOMAINS',
		'/CMD_API_PACKAGES_USER'
	]);
	const ALLOWED_PREFIXES = ['/api/users/', '/api/db-show/', '/api/domain-tls/'];

	const isAllowed =
		ALLOWED_PATHS.has(path) || ALLOWED_PREFIXES.some((p) => path.startsWith(p));
	if (!isAllowed) {
		throw error(400, 'Path is not in the debug allowlist. Add it explicitly in _debug-da-raw if needed.');
	}

	const user = event.url.searchParams.get('user');
	const fullPath = user ? `${path}?user=${encodeURIComponent(user)}` : path;

	const [srv] = await db
		.select()
		.from(table.daServer)
		.where(and(eq(table.daServer.tenantId, tenantId), eq(table.daServer.isActive, true)))
		.limit(1);
	if (!srv) throw error(404, 'No active DA server for this tenant');

	const username = decrypt(tenantId, srv.usernameEncrypted);
	const password = decrypt(tenantId, srv.passwordEncrypted);
	const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
	const proto = srv.useHttps !== false ? 'https' : 'http';
	const port = srv.port ?? 2222;
	const url = `${proto}://${srv.hostname}:${port}${fullPath}`;

	const r = await fetch(url, {
		method: 'GET',
		headers: { Authorization: auth, Accept: '*/*' },
		signal: AbortSignal.timeout(10_000),
		// @ts-expect-error Bun extends RequestInit with tls
		tls: { rejectUnauthorized: false }
	});
	const body = await r.text();

	return json({
		url,
		status: r.status,
		contentType: r.headers.get('content-type'),
		bodyLength: body.length,
		bodyPreview: body.slice(0, 4000)
	});
};
