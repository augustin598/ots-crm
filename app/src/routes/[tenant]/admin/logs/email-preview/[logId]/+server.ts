import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}

	const logId = event.params.logId;
	const tenantId = event.locals.tenant.id;

	const [log] = await db
		.select({ htmlBody: table.emailLog.htmlBody })
		.from(table.emailLog)
		.where(and(eq(table.emailLog.id, logId), eq(table.emailLog.tenantId, tenantId)))
		.limit(1);

	if (!log) {
		throw error(404, 'Email log not found');
	}
	if (!log.htmlBody) {
		throw error(404, 'No HTML preview available for this email');
	}

	return new Response(log.htmlBody, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Security-Policy':
				"default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:;",
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
